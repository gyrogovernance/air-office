import { useEffect, useEffectEvent, useState } from 'react';
import type { WorkspaceNode } from '@office/workspace/domain';
import { SelectField } from '../shared/select-field.component';
import { createServiceClient } from '../shared/service-client.hook';
import { Button } from '@heroui/react';

export function ResearchScope({ value, onChange, allowProgram = false, createProject = false, onManage }: { value: string; onChange: (id: string) => void; allowProgram?: boolean; createProject?: boolean; onManage?: () => void }) {
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [error, setError] = useState('');
  const currentSelection = useEffectEvent(() => value);
  const resetUnavailable = useEffectEvent((fresh: WorkspaceNode[], requested: string) => {
    if (value === requested && value && !fresh.some((node) => node.id === value && (node.kind === 'project' || allowProgram && node.kind === 'program'))) onChange('');
  });
  useEffect(() => {
    let active = true;
    const client = createServiceClient();
    const refresh = () => { const requested = currentSelection(); void client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes').then((result) => {
      if (active) { setNodes(result.nodes); setError(''); resetUnavailable(result.nodes, requested); }
    }).catch(() => { if (active) setError('Projects could not be loaded. Open Programs to check your work.'); }); };
    refresh();
    window.addEventListener('office-workspace-changed', refresh);
    return () => { active = false; window.removeEventListener('office-workspace-changed', refresh); };
  }, []);
  const locations = nodes.filter((node) => node.kind === 'project' || allowProgram && node.kind === 'program');
  return <section className="research-scope-picker" aria-label="Research project">
    <label className="research-question-field"><span>{allowProgram ? 'Program or project' : 'Project'}</span>
      <SelectField aria-label="Research project" value={locations.some((node) => node.id === value) ? value : ''} onValueChange={onChange}>
        <option value="">{createProject ? 'New project in AIR Fellowship' : allowProgram ? 'Choose a program or project' : 'Choose a project'}</option>
        {nodes.filter((node) => node.kind === 'program').map((program) => <optgroup key={program.id} label={program.name}>
          {allowProgram && <option value={program.id}>{createProject ? `New project in ${program.name}` : program.name}</option>}
          {locations.filter((node) => node.kind === 'project' && node.parentId === program.id).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </optgroup>)}
      </SelectField>
    </label>
    {onManage && <Button variant="secondary" size="sm" onPress={onManage}>Manage in Programs</Button>}
    {error && <p role="alert">{error}</p>}
    {value && !locations.some((node) => node.id === value) && nodes.length > 0 && <p role="status">The selected project is unavailable. Choose an existing project.</p>}
  </section>;
}
