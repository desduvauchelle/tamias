'use client'

import { useState, useEffect } from 'react'
import {
	AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
	PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts'
import {
	TrendingUp, Coins, Calendar, Clock, ArrowUpRight, ArrowDownRight,
	Zap, Cpu, Globe, Terminal, MessageSquare
} from 'lucide-react'

interface DataPoint {
	date: string
	cost: number
}

interface DistributionPoint {
	name: string
	value: number
}

interface CostsData {
	today: number
	yesterday: number
	thisWeek: number
	thisMonth: number
	total: number
	dailySpend: DataPoint[]
	modelDistribution: DistributionPoint[]
	initiatorDistribution: DistributionPoint[]
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

const StatCard = ({ title, value, previousValue, icon: Icon, colorClass = "text-primary" }: any) => {
	const diff = previousValue ? ((value - previousValue) / previousValue) * 100 : 0
	const isUp = diff > 0

	return (
		<div className="card bg-base-200 border border-base-300 shadow-sm transition-all hover:border-primary/30">
			<div className="card-body p-5">
				<div className="flex justify-between items-start">
					<div className="p-2 bg-base-300 rounded-lg">
						<Icon className={`w-5 h-5 ${colorClass}`} />
					</div>
					{previousValue !== undefined && (
						<div className={`flex items-center text-xs font-bold ${isUp ? 'text-error' : 'text-success'}`}>
							{isUp ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
							{Math.abs(diff).toFixed(1)}%
						</div>
					)}
				</div>
				<div className="mt-4">
					<h2 className="text-xs uppercase font-bold text-base-content/50 tracking-wider font-mono">{title}</h2>
					<p className="text-2xl font-black mt-1 font-mono">
						${value.toFixed(value < 0.1 ? 4 : 2)}
					</p>
				</div>
			</div>
		</div>
	)
}

export default function UsagePage() {
	const [data, setData] = useState<CostsData | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		fetch('/api/usage')
			.then(r => r.json())
			.then(d => {
				setData(d)
				setLoading(false)
			})
			.catch(err => {
				console.error(err)
				setLoading(false)
			})
	}, [])

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
				<span className="loading loading-ring loading-lg text-primary"></span>
				<p className="text-base-content/50 font-mono animate-pulse">Analyzing usage data...</p>
			</div>
		)
	}

	if (!data) return <div className="p-10 text-center font-mono">No data available</div>

	return (
		<div className="p-6 max-w-7xl mx-auto space-y-8 font-sans pb-32">
			{/* Header */}
			<div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
				<div>
					<div className="flex items-center gap-2 text-primary font-mono text-sm font-bold uppercase tracking-widest mb-1">
						<TrendingUp className="w-4 h-4" />
						Analytics
					</div>
					<h1 className="text-4xl font-black tracking-tight">Usage Insights</h1>
					<p className="text-base-content/60 mt-1 max-w-md">
						Real-time tracking of your AI consumption and spending patterns.
					</p>
				</div>
				<div className="bg-base-200 border border-base-300 px-4 py-2 rounded-xl flex items-center gap-3 shadow-sm">
					<div className="text-right">
						<div className="text-[10px] uppercase font-bold text-base-content/40 tracking-tighter">Total Spend</div>
						<div className="font-mono font-black text-xl leading-none">${data.total.toFixed(2)}</div>
					</div>
					<div className="divider divider-horizontal mx-0"></div>
					<Coins className="w-6 h-6 text-warning" />
				</div>
			</div>

			{/* Quick Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					title="Today"
					value={data.today}
					previousValue={data.yesterday}
					icon={Zap}
					colorClass="text-yellow-400"
				/>
				<StatCard
					title="Yesterday"
					value={data.yesterday}
					icon={Clock}
					colorClass="text-blue-400"
				/>
				<StatCard
					title="This Week"
					value={data.thisWeek}
					icon={Calendar}
					colorClass="text-purple-400"
				/>
				<StatCard
					title="This Month"
					value={data.thisMonth}
					icon={Globe}
					colorClass="text-emerald-400"
				/>
			</div>

			{/* Main Charts Row */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Area Chart: Spending Trend */}
				<div className="lg:col-span-2 card bg-base-200 border border-base-300 shadow-sm overflow-hidden">
					<div className="p-6 pb-0 border-b border-base-300/50 flex justify-between items-center">
						<div>
							<h3 className="text-lg font-bold">14-Day Spend Trend</h3>
							<p className="text-xs text-base-content/50">Daily cost in USD</p>
						</div>
						<TrendingUp className="w-5 h-5 text-primary opacity-50" />
					</div>
					<div className="p-4 h-[350px]">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={data.dailySpend || []}>
								<defs>
									<linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
										<stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
									</linearGradient>
								</defs>
								<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
								<XAxis
									dataKey="date"
									axisLine={false}
									tickLine={false}
									tick={{ fontSize: 10, fill: '#666' }}
									tickFormatter={(str: string) => {
										const date = new Date(str)
										return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
									}}
								/>
								<YAxis
									axisLine={false}
									tickLine={false}
									tick={{ fontSize: 10, fill: '#666' }}
									tickFormatter={(val: number) => `$${val.toFixed(2)}`}
								/>
								<Tooltip
									contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
									itemStyle={{ color: '#3b82f6' }}
									labelStyle={{ color: '#888', marginBottom: '4px', fontSize: '10px' }}
									formatter={(value: any) => [`$${parseFloat(value || 0).toFixed(4)}`, 'Cost']}
								/>
								<Area
									type="monotone"
									dataKey="cost"
									stroke="#3b82f6"
									strokeWidth={3}
									fillOpacity={1}
									fill="url(#colorCost)"
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</div>

				{/* Pie Chart: Model Distribution */}
				<div className="card bg-base-200 border border-base-300 shadow-sm overflow-hidden">
					<div className="p-6 pb-0 border-b border-base-300/50 flex justify-between items-center">
						<div>
							<h3 className="text-lg font-bold">Model Mix</h3>
							<p className="text-xs text-base-content/50">Spend by AI model</p>
						</div>
						<Cpu className="w-5 h-5 text-secondary opacity-50" />
					</div>
					<div className="p-4 h-[350px]">
						<ResponsiveContainer width="100%" height="100%">
							<PieChart>
								<Pie
									data={data.modelDistribution || []}
									cx="50%"
									cy="50%"
									innerRadius={60}
									outerRadius={90}
									paddingAngle={5}
									dataKey="value"
								>
									{(data.modelDistribution || []).map((_entry, index) => (
										<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
									))}
								</Pie>
								<Tooltip
									contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
									formatter={(value: any) => [`$${parseFloat(value || 0).toFixed(4)}`, 'Spend']}
								/>
								<Legend
									verticalAlign="bottom"
									align="center"
									layout="horizontal"
									iconType="circle"
									wrapperStyle={{ fontSize: '10px', paddingTop: '20px' }}
								/>
							</PieChart>
						</ResponsiveContainer>
					</div>
				</div>
			</div>

			{/* Bottom Row */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Bar Chart: Initiator Distribution */}
				<div className="card bg-base-200 border border-base-300 shadow-sm overflow-hidden">
					<div className="p-6 pb-0 border-b border-base-300/50 flex justify-between items-center">
						<div>
							<h3 className="text-lg font-bold">Channel Breakdown</h3>
							<p className="text-xs text-base-content/50">Cost by input source</p>
						</div>
						<MessageSquare className="w-5 h-5 text-accent opacity-50" />
					</div>
					<div className="p-4 h-[250px]">
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={data.initiatorDistribution || []} layout="vertical">
								<CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#333" />
								<XAxis type="number" hide />
								<YAxis
									dataKey="name"
									type="category"
									axisLine={false}
									tickLine={false}
									tick={{ fontSize: 11, fill: '#aaa' }}
									width={100}
								/>
								<Tooltip
									contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
									formatter={(value: any) => [`$${parseFloat(value || 0).toFixed(4)}`, 'Cost']}
								/>
								<Bar dataKey="value" fill="#8884d8" radius={[0, 4, 4, 0]} barSize={20}>
									{(data.initiatorDistribution || []).map((_entry, index) => (
										<Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>

				{/* Details / Legend Card */}
				<div className="card bg-gradient-to-br from-primary/10 to-base-300 border border-primary/20 shadow-sm p-6 flex flex-col justify-center">
					<div className="flex items-center gap-4">
						<div className="p-4 bg-primary/20 rounded-2xl">
							<Terminal className="w-8 h-8 text-primary" />
						</div>
						<div>
							<h4 className="text-xl font-bold">Smart Optimization</h4>
							<p className="text-sm text-base-content/70 mt-1">
								Your most used model is <span className="text-primary font-bold">{data.modelDistribution?.[0]?.name || 'N/A'}</span>.
								Consider switching to a 'mini' variant for repetitive tasks to save up to 80%.
							</p>
						</div>
					</div>
					<div className="divider opacity-20 my-4"></div>
					<div className="flex justify-between items-center text-xs font-mono uppercase tracking-widest text-base-content/40">
						<span>Updated: {new Date().toLocaleTimeString()}</span>
						<span>Estimates Only</span>
					</div>
				</div>
			</div>
		</div>
	)
}
