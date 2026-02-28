declare module 'qr-image' {
	import { Readable } from 'stream'

	interface Options {
		type?: 'png' | 'svg' | 'pdf' | 'eps'
		size?: number
		margin?: number
		ec_level?: 'L' | 'M' | 'Q' | 'H'
	}

	export function image(text: string, options?: Options): Readable
	export function imageSync(text: string, options?: Options): Buffer
	export function svgObject(text: string, options?: Options): any
	export function matrix(text: string, ec_level?: string): number[][]
}
