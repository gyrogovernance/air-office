import { useState } from 'react';
import { Card, Separator, SearchField } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookOpen01Icon } from '@hugeicons/core-free-icons';
import catalog from '../../../../tools/third-party.catalog.json';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { publicAsset } from '../static-demo/public-asset';
import { notices } from './references.catalog.json';

export function ReferencesWorkspace() {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const packages = catalog.packages.filter((item) => `${item.name} ${item.version} ${item.license}`.toLowerCase().includes(needle));
  return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="References">
    <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={BookOpen01Icon} size={18} aria-hidden="true" />References</Card.Title></Card.Header><Separator />
    <label className="app-dialog-field">Search dependencies<SearchField aria-label="Search dependencies" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Name, version or license" /><SearchField.ClearButton /></SearchField.Group></SearchField></label>
    <Card variant="tertiary" className="rounded-xl p-3 gap-0">
      <ul className="m-0 list-none p-0">
        {packages.map((item, index) => <li key={item.name}>
          {index > 0 && <Separator />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <a className="min-w-0 flex-1 break-all font-medium" href={item.source} target="_blank" rel="noreferrer">{item.name}</a>
            <span className="text-sm text-muted">{item.version} · {item.license}</span>
            <a className="text-sm" href={publicAsset(`licenses/${item.name.replaceAll('/', '__').replaceAll('@', '')}.txt`)} target="_blank" rel="noreferrer" aria-label={`License text for ${item.name}`}>License text</a>
          </div>
        </li>)}
      </ul>
      {packages.length === 0 && <p className="text-sm text-muted">No matching dependencies.</p>}
    </Card>
    {(!needle || 'lemonade apache-2.0 2026.42.1'.includes(needle)) && <article><h3>Lemonade 2026.42.1</h3><a href="https://github.com/lemonade-sdk/lemonade" target="_blank" rel="noreferrer">Upstream project</a><p>Local AI runtime. Additional engines and models retain their own licenses.</p><a href={publicAsset('licenses/lemonade-Apache-2.0.txt')} target="_blank" rel="noreferrer">Runtime license text</a></article>}
    {(!needle || 'arcade littlejs games mit twemoji cc-by-4.0'.includes(needle)) && <article><h3>LittleJS Arcade</h3><a href="https://github.com/KilledByAPixel/LittleJSArcade" target="_blank" rel="noreferrer">Upstream project</a><p>Bundled games and engine by Frank Force and contributors. MIT licensed. Game emoji artwork by Twitter, Inc and contributors, CC BY 4.0.</p><a href={publicAsset('arcade/LICENSE')} target="_blank" rel="noreferrer">MIT license text</a><span> · </span><a href={publicAsset('arcade/games/TWEMOJI-LICENSE.txt')} target="_blank" rel="noreferrer">Twemoji attribution</a></article>}
    {(!needle || 'fluent emoji microsoft arcade mit'.includes(needle)) && <article><h3>Microsoft Fluent Emoji</h3><a href="https://github.com/microsoft/fluentui-emoji" target="_blank" rel="noreferrer">Upstream project</a><p>Video game emoji used for the Arcade app icon and logo. MIT licensed.</p><a href={publicAsset('licenses/fluent-emoji-MIT.txt')} target="_blank" rel="noreferrer">License text</a></article>}
    {(!needle || 'momo signature font arcade ofl'.includes(needle)) && <article><h3>Momo Signature</h3><a href="https://github.com/fontsource/font-files" target="_blank" rel="noreferrer">Fontsource project</a><p>Font used for the Arcade wordmark. SIL Open Font License 1.1.</p><a href={publicAsset('licenses/momo-signature-OFL.txt')} target="_blank" rel="noreferrer">License text</a></article>}
    {(!needle || 'caprasimo font today headlines ofl'.includes(needle)) && <article><h3>Caprasimo</h3><a href="https://github.com/google/fonts/tree/main/ofl/caprasimo" target="_blank" rel="noreferrer">Google Fonts source</a><p>Font used for Today edition headlines. SIL Open Font License 1.1.</p><a href={publicAsset('licenses/caprasimo-OFL.txt')} target="_blank" rel="noreferrer">License text</a></article>}
    <CollapsibleSection title="Acknowledgments and third-party notices"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notices}</pre></CollapsibleSection>
    <a href={publicAsset('licenses/coiny-OFL.txt')} target="_blank" rel="noreferrer">Coiny font license</a>
  </Card>;
}
