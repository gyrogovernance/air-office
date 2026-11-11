const vscode = require('vscode');

const WELCOME_VIEW_TYPE = 'airoffice.shell.welcome';

/** @type {vscode.WebviewPanel | undefined} */
let welcomePanel;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('airoffice.shell.showWelcome', () => showWelcome(context)),
  );
  const openIfEmpty = () => {
    if (!vscode.workspace.workspaceFolders?.length) showWelcome(context);
  };
  // Delay past the first workbench layout pass so the webview is not discarded.
  setTimeout(openIfEmpty, 400);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(openIfEmpty));
}

/** @param {vscode.ExtensionContext} context */
function showWelcome(context) {
  if (welcomePanel) {
    welcomePanel.reveal(vscode.ViewColumn.Active);
    return;
  }
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  welcomePanel = vscode.window.createWebviewPanel(
    WELCOME_VIEW_TYPE,
    'AIR Office',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    },
  );
  const fontsRoot = vscode.Uri.joinPath(mediaRoot, 'fonts');
  const latinUri = welcomePanel.webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'nunito-latin-wght-normal.woff2'));
  const latinExtUri = welcomePanel.webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'nunito-latin-ext-wght-normal.woff2'));
  welcomePanel.webview.html = welcomeHtml(String(latinUri), String(latinExtUri), welcomePanel.webview.cspSource);
  welcomePanel.onDidDispose(() => { welcomePanel = undefined; }, undefined, context.subscriptions);
  welcomePanel.webview.onDidReceiveMessage(async (message) => {
    if (!message || typeof message.command !== 'string') return;
    try {
      await vscode.commands.executeCommand(message.command);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'That action could not run.';
      void vscode.window.showErrorMessage(text);
    }
  }, undefined, context.subscriptions);
}

/**
 * @param {string} latinUri
 * @param {string} latinExtUri
 * @param {string} cspSource
 */
function welcomeHtml(latinUri, latinExtUri, cspSource) {
  const ideas = [
    {
      eyebrow: 'Start',
      title: 'Open a project folder',
      description: 'Choose a folder from your computer and edit it in Explorer.',
      action: 'Open Folder',
      command: 'workbench.action.files.openFolder',
    },
    {
      eyebrow: 'Browse',
      title: 'Find a file quickly',
      description: 'Jump to any file by name once a folder is open.',
      action: 'Quick Open',
      command: 'workbench.action.quickOpen',
    },
    {
      eyebrow: 'Search',
      title: 'Search across the project',
      description: 'Look for text in every file in the open folder.',
      action: 'Search',
      command: 'workbench.action.findInFiles',
    },
    {
      eyebrow: 'Terminal',
      title: 'Run in the terminal',
      description: 'Open the integrated terminal for builds, git, and scripts.',
      action: 'Terminal',
      command: 'workbench.action.terminal.toggleTerminal',
    },
    {
      eyebrow: 'Tools',
      title: 'Install an extension',
      description: 'Add language tools. Python, TypeScript, and ESLint are already included.',
      action: 'Extensions',
      command: 'workbench.view.extensions',
    },
  ];

  const cards = ideas.map((idea) => `
    <button type="button" class="idea" data-command="${escapeHtml(idea.command)}">
      <span class="eyebrow">${escapeHtml(idea.eyebrow)}</span>
      <strong>${escapeHtml(idea.title)}</strong>
      <p>${escapeHtml(idea.description)}</p>
      <span class="idea-action">${escapeHtml(idea.action)}</span>
    </button>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${escapeHtml(cspSource)}; style-src ${escapeHtml(cspSource)} 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AIR Office</title>
  <style>
    @font-face {
      font-family: 'Nunito Variable';
      font-style: normal;
      font-display: swap;
      font-weight: 200 1000;
      src: url("${escapeHtml(latinExtUri)}") format('woff2-variations');
      unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;
    }
    @font-face {
      font-family: 'Nunito Variable';
      font-style: normal;
      font-display: swap;
      font-weight: 200 1000;
      src: url("${escapeHtml(latinUri)}") format('woff2-variations');
      unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
    }
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background, #f8f8fa);
      --fg: var(--vscode-foreground, #1c1c1f);
      --muted: var(--vscode-descriptionForeground, #6b6b76);
      --card: var(--vscode-sideBar-background, #efeff2);
      --border: var(--vscode-widget-border, #d0d0d7);
      --accent: var(--vscode-button-background, #0d74ce);
      --accent-fg: var(--vscode-button-foreground, #fff);
      --ghost: var(--vscode-button-secondaryBackground, #e4e4ea);
      --ghost-fg: var(--vscode-button-secondaryForeground, #1c1c1f);
      --radius: 16px;
      font-family: 'Nunito Variable', Nunito, ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 32px 28px 48px;
      background: var(--bg);
      color: var(--fg);
    }
    main {
      width: min(100%, 920px);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 20px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 10px;
    }
    .actions button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 10px 18px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .actions .primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .actions .secondary {
      background: var(--ghost);
      color: var(--ghost-fg);
    }
    .ideas-label {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.13em;
      text-transform: uppercase;
    }
    .ideas {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      text-align: left;
    }
    .idea {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      min-height: 148px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .idea:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
    .eyebrow {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .idea strong { font-size: 0.98rem; line-height: 1.3; }
    .idea p {
      margin: 0;
      flex: 1;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }
    .idea-action {
      color: var(--accent);
      font-size: 0.8rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main>
    <div class="actions">
      <button type="button" class="primary" data-command="workbench.action.files.openFolder">Open Folder</button>
      <button type="button" class="secondary" data-command="workbench.action.openRecent">Open Recent</button>
    </div>
    <p class="ideas-label">Ideas</p>
    <div class="ideas">${cards}</div>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-command]');
      if (!target) return;
      vscode.postMessage({ command: target.getAttribute('data-command') });
    });
  </script>
</body>
</html>`;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deactivate() {}

module.exports = { activate, deactivate };
