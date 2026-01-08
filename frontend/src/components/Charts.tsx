"use client";

import { useState, useEffect, useRef } from "react";
import { formatINR } from "@/lib/utils";

// Hook to ensure client-side only rendering and get container size
function useChartDimensions(defaultWidth = 600, defaultHeight = 280) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: defaultWidth, height: defaultHeight });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(width - 20, 300),
          height: Math.max(height - 20, 200),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    // Update after a short delay to ensure container is rendered
    const timeout = setTimeout(updateDimensions, 100);

    return () => {
      window.removeEventListener("resize", updateDimensions);
      clearTimeout(timeout);
    };
  }, []);

  return { containerRef, dimensions, mounted };
}

interface DailyData {
  date: string;
  pnl: number;
  cumulative_pnl: number;
}

interface SetupData {
  setup: string;
  pnl: number;
  trades: number;
  win_rate: number;
}

// Equity Curve Chart - Custom SVG implementation
export function EquityCurveChart({ data }: { data: DailyData[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) {
    return <div>No data for chart</div>;
  }

  // Sort by date
  const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = dimensions.width;
  const height = dimensions.height;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const values = sortedData.map(d => d.cumulative_pnl);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.1 || 1000;
  const yMin = minVal - padding;
  const yMax = maxVal + padding;

  // Scale functions
  const xScale = (i: number) => margin.left + (i / (sortedData.length - 1)) * innerWidth;
  const yScale = (v: number) => margin.top + innerHeight - ((v - yMin) / (yMax - yMin)) * innerHeight;

  // Build path
  const pathD = sortedData
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.cumulative_pnl)}`)
    .join(' ');

  // Y-axis ticks
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => yMin + (i / (yTicks - 1)) * (yMax - yMin));

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height} className="overflow-visible">
        {/* Grid lines */}
        {yTickValues.map((v, i) => (
          <line key={i} x1={margin.left} x2={width - margin.right} y1={yScale(v)} y2={yScale(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}

        {/* Y-axis */}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#d1d5db" />
        {yTickValues.map((v, i) => (
          <text key={i} x={margin.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
            ₹{(v / 1000).toFixed(0)}K
          </text>
        ))}

        {/* X-axis */}
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#d1d5db" />
        {sortedData.map((d, i) => (
          <text key={i} x={xScale(i)} y={height - margin.bottom + 16} textAnchor="middle" fontSize={11} fill="#6b7280">
            {d.date.slice(5, 10)}
          </text>
        ))}

        {/* Line */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} />

        {/* Dots */}
        {sortedData.map((d, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(d.cumulative_pnl)} r={4} fill="#3b82f6">
            <title>{d.date.slice(5, 10)}: {formatINR(d.cumulative_pnl)}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// Daily PnL Bar Chart - Custom SVG
export function DailyPnLChart({ data }: { data: DailyData[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) return null;

  const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = dimensions.width;
  const height = dimensions.height;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const values = sortedData.map(d => d.pnl);
  const maxAbs = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)));
  const yMax = maxAbs * 1.1;
  const yMin = -yMax;

  const barWidth = innerWidth / sortedData.length * 0.7;
  const barGap = innerWidth / sortedData.length * 0.15;

  const xScale = (i: number) => margin.left + barGap + i * (innerWidth / sortedData.length);
  const yScale = (v: number) => margin.top + innerHeight / 2 - (v / yMax) * (innerHeight / 2);
  const zeroY = margin.top + innerHeight / 2;

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => yMin + (i / (yTicks - 1)) * (yMax - yMin));

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height}>
        {/* Grid lines */}
        {yTickValues.map((v, i) => (
          <line key={i} x1={margin.left} x2={width - margin.right} y1={yScale(v)} y2={yScale(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        {/* Zero line */}
        <line x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} stroke="#9ca3af" strokeWidth={1} />

        {/* Y-axis */}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#d1d5db" />
        {yTickValues.map((v, i) => (
          <text key={i} x={margin.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
            ₹{(v / 1000).toFixed(0)}K
          </text>
        ))}

        {/* X-axis labels */}
        {sortedData.map((d, i) => (
          <text key={i} x={xScale(i) + barWidth / 2} y={height - margin.bottom + 16} textAnchor="middle" fontSize={11} fill="#6b7280">
            {d.date.slice(5, 10)}
          </text>
        ))}

        {/* Bars */}
        {sortedData.map((d, i) => {
          const barHeight = Math.abs(d.pnl / yMax) * (innerHeight / 2);
          const barY = d.pnl >= 0 ? zeroY - barHeight : zeroY;
          return (
            <rect
              key={i}
              x={xScale(i)}
              y={barY}
              width={barWidth}
              height={barHeight}
              fill={d.pnl >= 0 ? "#22c55e" : "#ef4444"}
            >
              <title>{d.date.slice(5, 10)}: {formatINR(d.pnl)}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// PnL by Setup Chart (horizontal bar) - Custom SVG
export function SetupPnLChart({ data }: { data: SetupData[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) return null;

  const margin = { top: 20, right: 30, bottom: 30, left: 100 };
  const width = dimensions.width;
  const height = dimensions.height;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const values = data.map(d => d.pnl);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(0, ...values);
  const xMin = minVal - Math.abs(minVal) * 0.1;
  const xMax = maxVal + Math.abs(maxVal) * 0.1;

  const barHeight = innerHeight / data.length * 0.7;
  const barGap = innerHeight / data.length * 0.15;

  const xScale = (v: number) => margin.left + ((v - xMin) / (xMax - xMin)) * innerWidth;
  const yScale = (i: number) => margin.top + barGap + i * (innerHeight / data.length);
  const zeroX = xScale(0);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height}>
        {/* Zero line */}
        <line x1={zeroX} x2={zeroX} y1={margin.top} y2={height - margin.bottom} stroke="#9ca3af" strokeWidth={1} />

        {/* Y-axis labels (setup names) */}
        {data.map((d, i) => (
          <text key={i} x={margin.left - 8} y={yScale(i) + barHeight / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
            {d.setup.length > 12 ? d.setup.slice(0, 12) + '...' : d.setup}
          </text>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const barW = Math.abs(xScale(d.pnl) - zeroX);
          const barX = d.pnl >= 0 ? zeroX : zeroX - barW;
          return (
            <rect
              key={i}
              x={barX}
              y={yScale(i)}
              width={barW}
              height={barHeight}
              fill={d.pnl >= 0 ? "#22c55e" : "#ef4444"}
            >
              <title>{d.setup}: {formatINR(d.pnl)}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// Trade Distribution Pie Chart - Custom SVG
export function TradeDistributionChart({ data, colors }: { data: SetupData[]; colors: string[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) return null;

  const width = dimensions.width;
  const height = dimensions.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 40;

  const total = data.reduce((sum, d) => sum + d.trades, 0);
  let currentAngle = -Math.PI / 2;

  const slices = data.map((d, i) => {
    const sliceAngle = (d.trades / total) * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const midAngle = startAngle + sliceAngle / 2;
    const labelRadius = radius + 20;
    const labelX = cx + labelRadius * Math.cos(midAngle);
    const labelY = cy + labelRadius * Math.sin(midAngle);

    return {
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      color: colors[i % colors.length],
      label: d.setup,
      labelX,
      labelY,
      trades: d.trades,
      midAngle,
    };
  });

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height}>
        {slices.map((slice, i) => (
          <g key={i}>
            <path d={slice.path} fill={slice.color}>
              <title>{slice.label}: {slice.trades} trades</title>
            </path>
            <text
              x={slice.labelX}
              y={slice.labelY}
              textAnchor={slice.midAngle > Math.PI / 2 && slice.midAngle < 3 * Math.PI / 2 ? "end" : "start"}
              dominantBaseline="middle"
              fontSize={10}
              fill="#374151"
            >
              {slice.label.length > 10 ? slice.label.slice(0, 10) + '..' : slice.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// Win Rate by Setup Chart - Custom SVG
export function WinRateChart({ data }: { data: SetupData[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) return null;

  const margin = { top: 20, right: 30, bottom: 50, left: 50 };
  const width = dimensions.width;
  const height = dimensions.height;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const barWidth = innerWidth / data.length * 0.7;
  const barGap = innerWidth / data.length * 0.15;

  const xScale = (i: number) => margin.left + barGap + i * (innerWidth / data.length);
  const yScale = (v: number) => margin.top + innerHeight - (v / 100) * innerHeight;

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height}>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line key={i} x1={margin.left} x2={width - margin.right} y1={yScale(v)} y2={yScale(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        {/* 50% line */}
        <line x1={margin.left} x2={width - margin.right} y1={yScale(50)} y2={yScale(50)} stroke="#f59e0b" strokeWidth={1} />

        {/* Y-axis */}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#d1d5db" />
        {yTicks.map((v, i) => (
          <text key={i} x={margin.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
            {v}%
          </text>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text key={i} x={xScale(i) + barWidth / 2} y={height - margin.bottom + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
            {d.setup.length > 8 ? d.setup.slice(0, 8) + '..' : d.setup}
          </text>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = (d.win_rate / 100) * innerHeight;
          return (
            <rect
              key={i}
              x={xScale(i)}
              y={yScale(d.win_rate)}
              width={barWidth}
              height={barH}
              fill={d.win_rate >= 50 ? "#22c55e" : "#ef4444"}
            >
              <title>{d.setup}: {d.win_rate.toFixed(1)}%</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// PnL Distribution Histogram - Custom SVG
export function PnLHistogramChart({ data }: { data: { range: string; count: number }[] }) {
  const { containerRef, dimensions, mounted } = useChartDimensions();

  if (!mounted) return <div className="w-full h-full flex items-center justify-center text-gray-400">Loading chart...</div>;
  if (!data || data.length === 0) return null;

  const margin = { top: 20, right: 30, bottom: 60, left: 50 };
  const width = dimensions.width;
  const height = dimensions.height;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const maxCount = Math.max(...data.map(d => d.count));
  const yMax = maxCount * 1.1;

  const barWidth = innerWidth / data.length * 0.8;
  const barGap = innerWidth / data.length * 0.1;

  const xScale = (i: number) => margin.left + barGap + i * (innerWidth / data.length);
  const yScale = (v: number) => margin.top + innerHeight - (v / yMax) * innerHeight;

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => Math.round((i / (yTicks - 1)) * yMax));

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={width} height={height}>
        {/* Grid lines */}
        {yTickValues.map((v, i) => (
          <line key={i} x1={margin.left} x2={width - margin.right} y1={yScale(v)} y2={yScale(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}

        {/* Y-axis */}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#d1d5db" />
        {yTickValues.map((v, i) => (
          <text key={i} x={margin.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
            {v}
          </text>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={xScale(i) + barWidth / 2}
            y={height - margin.bottom + 8}
            textAnchor="end"
            fontSize={9}
            fill="#6b7280"
            transform={`rotate(-45 ${xScale(i) + barWidth / 2} ${height - margin.bottom + 8})`}
          >
            {d.range}
          </text>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = (d.count / yMax) * innerHeight;
          return (
            <rect
              key={i}
              x={xScale(i)}
              y={yScale(d.count)}
              width={barWidth}
              height={barH}
              fill="#3b82f6"
            >
              <title>{d.range}: {d.count}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
