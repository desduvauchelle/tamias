import { ReactNode, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
	isOpen: boolean
	onClose: () => void
	title?: ReactNode
	children: ReactNode
	footer?: ReactNode
	className?: string
}

export function Modal({ isOpen, onClose, title, children, footer, className = 'w-11/12 max-w-5xl' }: ModalProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog) return

		if (isOpen) {
			if (!dialog.open) dialog.showModal()
		} else {
			if (dialog.open) dialog.close()
		}
	}, [isOpen])

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog) return

		const handleClose = () => {
			onClose()
		}

		dialog.addEventListener('close', handleClose)
		return () => dialog.removeEventListener('close', handleClose)
	}, [onClose])

	return (
		<dialog ref={dialogRef} className="modal">
			<div className={`modal-box bg-base-200 border border-base-300 p-0 overflow-hidden flex flex-col max-h-[90vh] ${className}`}>
				{/* Header */}
				{title && (
					<div className="px-6 py-4 border-b border-base-300 bg-base-300/50 flex items-center justify-between shrink-0">
						<div className="flex-1 min-w-0">{title}</div>
						<button
							className="btn btn-sm btn-ghost btn-square shrink-0 ml-4"
							onClick={() => dialogRef.current?.close()}
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				)}

				{/* Content */}
				<div className="p-6 overflow-y-auto flex-1 flex flex-col">
					{children}
				</div>

				{/* Footer */}
				{footer && (
					<div className="p-4 border-t border-base-300 bg-base-300/30 shrink-0 m-0">
						{footer}
					</div>
				)}
			</div>
			<form method="dialog" className="modal-backdrop bg-base-900/40 backdrop-blur-[2px]">
				<button>close</button>
			</form>
		</dialog>
	)
}
