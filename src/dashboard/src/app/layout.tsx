import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"
import "./globals.css"
import Nav from "./_components/Nav"
import { ToastProvider } from "./_components/ToastProvider"

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
})

export const metadata: Metadata = {
	title: "TamiasOS Dashboard",
	description: "Autonomous Agent Control Center",
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en" data-theme="dark">
			<body className={`${geistMono.variable} antialiased`}>
				<ToastProvider>
					<div className="flex h-screen overflow-hidden">
						<Nav />
						<main className="flex-1 overflow-y-auto">
							{children}
						</main>
					</div>
				</ToastProvider>
			</body>
		</html>
	)
}
