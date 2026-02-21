'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface Toast {
	id: string
	message: string
	variant: ToastVariant
}

interface ToastContextValue {
	toast: (message: string, variant?: ToastVariant) => void
	success: (message: string) => void
	error: (message: string) => void
	warning: (message: string) => void
	info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION = 4000

const variantClasses: Record<ToastVariant, string> = {
	success: 'alert-success',
	error: 'alert-error',
	warning: 'alert-warning',
	info: 'alert-info',
}

const variantIcons: Record<ToastVariant, React.ReactElement> = {
	success: (
		<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
		</svg>
	),
	error: (
		<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
		</svg>
	),
	warning: (
		<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
		</svg>
	),
	info: (
		<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
		</svg>
	),
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
	const [visible, setVisible] = useState(false)
	const [leaving, setLeaving] = useState(false)

	useEffect(() => {
		// Trigger enter animation
		const enterTimer = setTimeout(() => setVisible(true), 10)

		// Start exit animation before removal
		const leaveTimer = setTimeout(() => setLeaving(true), TOAST_DURATION - 300)

		return () => {
			clearTimeout(enterTimer)
			clearTimeout(leaveTimer)
		}
	}, [])

	const dismiss = useCallback(() => {
		setLeaving(true)
		setTimeout(() => onDismiss(toast.id), 300)
	}, [toast.id, onDismiss])

	return (
		<div
			role="alert"
			className={`
				alert ${variantClasses[toast.variant]} shadow-lg cursor-pointer
				flex items-center gap-3 text-sm font-medium
				transition-all duration-300 ease-out
				${visible && !leaving ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
			`}
			onClick={dismiss}
		>
			{variantIcons[toast.variant]}
			<span>{toast.message}</span>
		</div>
	)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([])
	const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

	const dismiss = useCallback((id: string) => {
		setToasts(prev => prev.filter(t => t.id !== id))
		const timer = timersRef.current.get(id)
		if (timer) {
			clearTimeout(timer)
			timersRef.current.delete(id)
		}
	}, [])

	const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
		const id = `toast-${Date.now()}-${Math.random()}`
		setToasts(prev => [...prev, { id, message, variant }])

		const timer = setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id))
			timersRef.current.delete(id)
		}, TOAST_DURATION)

		timersRef.current.set(id, timer)
	}, [])

	const ctx: ToastContextValue = {
		toast: addToast,
		success: (msg) => addToast(msg, 'success'),
		error: (msg) => addToast(msg, 'error'),
		warning: (msg) => addToast(msg, 'warning'),
		info: (msg) => addToast(msg, 'info'),
	}

	return (
		<ToastContext.Provider value={ctx}>
			{children}
			{/* DaisyUI toast stack — bottom-end */}
			<div className="toast toast-end toast-bottom z-50 pointer-events-none">
				<div className="flex flex-col gap-2 pointer-events-auto">
					{toasts.map(t => (
						<ToastItem key={t.id} toast={t} onDismiss={dismiss} />
					))}
				</div>
			</div>
		</ToastContext.Provider>
	)
}

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext)
	if (!ctx) {
		throw new Error('useToast must be used inside <ToastProvider>')
	}
	return ctx
}
