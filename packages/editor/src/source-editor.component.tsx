import { useLayoutEffect, useRef } from 'react';
import { createSourceEditor, type SourceEditorController, type SourceEditorOptions } from './source-editor.adapter';

export interface SourceEditorProps extends SourceEditorOptions { fileId: string }

export function SourceEditor(props: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<SourceEditorController | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  useLayoutEffect(() => {
    if (!host.current) return;
    const current = latest.current;
    const instance = createSourceEditor(host.current, {
      name: current.name, content: current.content, readOnly: current.readOnly, theme: current.theme,
      onChange: (content) => latest.current.onChange(content),
      onSelectionChange: (selection) => latest.current.onSelectionChange?.(selection),
      onSave: () => latest.current.onSave?.()
    });
    editor.current = instance;
    return () => { instance.destroy(); editor.current = null; };
  }, [props.fileId]);
  useLayoutEffect(() => { editor.current?.configure({ name: props.name, theme: props.theme, readOnly: props.readOnly }); }, [props.name, props.theme, props.readOnly, props.fileId]);
  useLayoutEffect(() => { editor.current?.setContent(props.content); }, [props.content, props.fileId]);
  return <div ref={host} className="source-editor" data-file-id={props.fileId} style={{ height: '100%', minHeight: 180, minWidth: 0, overflow: 'hidden' }} />;
}
