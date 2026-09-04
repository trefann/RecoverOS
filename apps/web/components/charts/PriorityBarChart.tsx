"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#555d6e",
  MEDIUM: "#3b82f6",
  HIGH: "#2563eb",
};

export function PriorityBarChart({
  data,
}: {
  data: Array<{ priority: string; amountAtRisk: number; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1e2530" vertical={false} />
        <XAxis dataKey="priority" tick={{ fill: "#8890a0", fontSize: 11 }} axisLine={{ stroke: "#1e2530" }} tickLine={false} />
        <YAxis tick={{ fill: "#8890a0", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          contentStyle={{ background: "#0a0d14", border: "1px solid #1e2530", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#f5f7fa" }}
          formatter={(value: number, name: string) => [value, name === "amountAtRisk" ? "Amount at risk" : name]}
        />
        <Bar dataKey="amountAtRisk" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.priority} fill={PRIORITY_COLOR[entry.priority] ?? "#555d6e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
