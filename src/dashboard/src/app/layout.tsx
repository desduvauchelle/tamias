import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"
import "./globals.css"
import { ToastProvider } from "./_components/ToastProvider"
import { QueryProvider } from "./_components/QueryProvider"
import LayoutClient from "./_components/LayoutClient"

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
				<QueryProvider>
					<ToastProvider>
						<LayoutClient>{children}</LayoutClient>
					</ToastProvider>
				</QueryProvider>
			</body>
		</html>
	)
}
