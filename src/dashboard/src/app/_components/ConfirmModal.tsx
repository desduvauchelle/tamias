'use client'

import { Modal } from './Modal'

interface ConfirmModalProps {
	isOpen: boolean
	onClose: () => void
	onConfirm: () => void
	title?: string
	message: string
	confirmLabel?: string
	cancelLabel?: string
	variant?: 'error' | 'warning' | 'info'
}

export function ConfirmModal({
	isOpen,
	onClose,
	onConfirm,
	title = 'Confirm',
	message,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	variant = 'error',
}: ConfirmModalProps) {
	const btnClass =
		variant === 'error' ? 'btn-error' :
			variant === 'warning' ? 'btn-warning' :
				'btn-info'

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={<h3 className="text-lg font-semibold">{title}</h3>}
			className="w-11/12 max-w-md"
			footer={
				<div className="flex justify-end gap-2">
					<button
						data-testid="confirm-cancel"
						onClick={onClose}
						className="btn btn-ghost"
					>
						{cancelLabel}
					</button>
					<button
						data-testid="confirm-yes"
						onClick={() => { onConfirm(); onClose() }}
						className={`btn ${btnClass}`}
					>
						{confirmLabel}
					</button>
				</div>
			}
		>
			<p data-testid="confirm-message" className="text-base-content/80">{message}</p>
		</Modal>
	)
}
