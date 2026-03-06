import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"
import "./globals.css"
import Nav from "./_components/Nav"
import { ToastProvider } from "./_components/ToastProvider"
import { QueryProvider } from "./_components/QueryProvider"
import { Menu } from "lucide-react"

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
						<div className="drawer lg:drawer-open h-screen">
							<input id="nav-drawer" type="checkbox" className="drawer-toggle" />
							<div className="drawer-content flex flex-col h-full overflow-hidden">
								{/* Mobile Header */}
								<header className="lg:hidden flex items-center justify-between p-4 bg-base-200 border-b border-base-300">
									<div className="flex items-center gap-2">
										<label htmlFor="nav-drawer" className="btn btn-ghost btn-sm btn-square">
											<Menu className="w-5 h-5" />
										</label>
										<span className="font-bold text-base-content font-mono tracking-tight">TamiasOS</span>
									</div>
								</header>

								<main className="flex-1 overflow-y-auto bg-base-100">
									{children}
								</main>
							</div>

							<div className="drawer-side z-50">
								<label htmlFor="nav-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
								<Nav />
							</div>
						</div>
					</ToastProvider>
				</QueryProvider>
			</body>
		</html>
	)
}
