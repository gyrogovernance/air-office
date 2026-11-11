import { Modal } from '@heroui/react';
import type { ServiceClient } from '../shared/service-client.hook';
import { DeviceCapture } from '../media/device-capture.component';
import type { CapturedMedia } from '../media/device-capture.adapter';

/**
 * Camera capture from the composer attach menu. The captured file is handed to
 * the existing attachment adapter the same way an uploaded file is.
 */
export function ComposerCaptureDialog(props: {
  client: ServiceClient;
  onCapture: (file: File, media: CapturedMedia) => void;
  onClose: () => void;
}) {
  return <Modal isOpen onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Modal.Backdrop>
      <Modal.Container>
        <Modal.Dialog aria-label="Capture from camera">
          <div className="compose-attach-content">
            <div className="compose-attach-head"><h2>Camera</h2></div>
            <div className="compose-attach-body">
              <DeviceCapture client={props.client} persist={false} onAttached={({ file, media }) => { props.onCapture(file, media); props.onClose(); }} />
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
