import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';
import { ComposerKnowledgePicker } from './composer-knowledge-picker.component';
import type { ComposerContextSelection } from './composer-context.policy';
import { cameraSupported } from '../media/device-capture.adapter';
import { Button, Modal } from '@heroui/react';

/**
 * The attach dialog of the composer.
 *
 * The plus button of the composer opens this dialog. It offers files,
 * knowledge, and camera capture where the browser supports it. Choosing
 * knowledge moves the dialog to the picker; camera opens a separate capture
 * dialog. It does not index or edit collections; that stays in Settings.
 */
export function ComposerAttachDialog(props: {
  knowledge: KnowledgeWorkspaceState;
  selection: ComposerContextSelection;
  onChange: (selection: ComposerContextSelection) => void;
  onUploadFiles: () => void;
  onCapture?: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'menu' | 'knowledge'>('menu');
  const captureOk = cameraSupported();

  return <Modal isOpen onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Modal.Backdrop>
      <Modal.Container>
        <Modal.Dialog aria-label="Attach to this message">
    <div className="compose-attach-content">
      <div className="compose-attach-head">
        {step === 'knowledge' && <Button variant="ghost" size="sm" aria-label="Back to the attach menu" onPress={() => setStep('menu')}><HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />Back</Button>}
        <h2>{step === 'knowledge' ? 'Attach knowledge' : 'Attach'}</h2>
      </div>
      {step === 'menu' ? <div className="compose-attach-menu">
        <Button variant="tertiary" size="sm" onPress={() => { props.onClose(); props.onUploadFiles(); }}>Upload files</Button>
        <Button variant="tertiary" size="sm" onPress={() => setStep('knowledge')}>Attach knowledge</Button>
        {captureOk && props.onCapture && <Button variant="tertiary" size="sm" onPress={() => { props.onClose(); props.onCapture?.(); }}>Camera</Button>}
      </div> : <div className="compose-attach-body">
        <ComposerKnowledgePicker knowledge={props.knowledge} selection={props.selection} onChange={props.onChange}/>
      </div>}
      <div className="compose-attach-foot">
        <Button variant="tertiary" size="sm" onPress={props.onClose}>{step === 'knowledge' ? 'Done' : 'Cancel'}</Button>
      </div>
    </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
