"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export function RecoveredTrendChart({ data }: { data: Array<{ date: string; amount: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="recoveredFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5f7fa" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#f5f7fa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e2530" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "#8890a0", fontSize: 11 }}
          axisLine={{ stroke: "#1e2530" }}
          tickLine={false}
        />
        <YAxis tick={{ fill: "#8890a0", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          contentStyle={{ background: "#0a0d14", border: "1px solid #1e2530", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#f5f7fa" }}
        />
        <Area type="monotone" dataKey="amount" stroke="#f5f7fa" fill="url(#recoveredFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
