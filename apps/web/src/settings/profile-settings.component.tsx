import { useRef, useState } from 'react';
import { Avatar, Button, Input } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ImageAdd01Icon } from '@hugeicons/core-free-icons';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';
import { readProfile, writeProfile } from './profile.store';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

/** Profile photo and display name for the person using AIR Office. */
export function ProfileSettingsSection() {
  const initial = readProfile();
  const [name, setName] = useState(initial.name);
  const [photo, setPhoto] = useState(initial.photo);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function save(nextName: string, nextPhoto: string) {
    setName(nextName);
    setPhoto(nextPhoto);
    writeProfile({ name: nextName, photo: nextPhoto });
    setNotice('Profile saved.');
    setError('');
  }

  async function onPhotoChosen(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('The photo must be smaller than 2 MB.');
      return;
    }
    try {
      save(name, await readPhoto(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The photo could not be read.');
    }
  }

  return (
    <section className="settings-group settings-profile" aria-label="Profile">
      <div className="settings-profile-identity">
        <div className="settings-profile-avatar">
          {photo ? <img src={photo} alt="" /> : <Avatar size="lg" className="settings-profile-avatar-fallback"><Avatar.Fallback><MarbleBeamAvatar name={name || 'AIR Office'} size={72}/></Avatar.Fallback></Avatar>}
        </div>
        <div className="settings-profile-actions">
          <Button variant="secondary" size="sm" onPress={() => fileInput.current?.click()}>
            <HugeiconsIcon icon={ImageAdd01Icon} size={16} aria-hidden="true" />
            Upload photo
          </Button>
          {photo && (
            <Button variant="tertiary" size="sm" onPress={() => save(name, '')}>
              Remove photo
            </Button>
          )}
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/*"
            aria-label="Profile photo"
            onChange={(event) => {
              void onPhotoChosen(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Name</span>
          <span className="settings-pref-help">Shown on your profile and in shared conversations.</span>
        </div>
        <Input
          className="settings-profile-name"
          type="text"
          aria-label="Profile name"
          maxLength={80}
          value={name}
          placeholder="Your name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => save(name, photo)}
        />
      </div>
      {error && (
        <p className="settings-flag-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-profile-notice" role="status">
          {notice}
        </p>
      )}
      {!photo && !name && <p className="settings-profile-hint">Add a name and a photo so AIR Office can greet you.</p>}
    </section>
  );
}
