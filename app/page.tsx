"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  CrosshairMode,
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CandlestickData,
  HistogramData,
  ISeriesApi,
  Time,
} from "lightweight-charts";

type TwelveDataCandle = {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type PriceEvent = {
  event: string;
  symbol: string;
  currency: string;
  exchange: string;
  type: string;
  timestamp: number;
  price: number;
};

type CandleAggregator = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  lastUpdate: number;
};

// Convert UTC timestamp to local timezone
const convertToLocalTime = (utcTimestamp: number): number => {
  const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;
  return utcTimestamp - timezoneOffsetSeconds;
};

export default function CombinedLiveHistoricalChart() {
  const { theme } = useTheme();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const currentCandleRef = useRef<CandleAggregator | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isHistoricalLoaded, setIsHistoricalLoaded] = useState(false);
  const [status, setStatus] = useState("Loading historical data...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Interval in seconds (60 = 1 minute candles)
  const CANDLE_INTERVAL = 60;

  const getCandleTimestamp = (timestamp: number): number => {
    return Math.floor(timestamp / CANDLE_INTERVAL) * CANDLE_INTERVAL;
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      layout: {
        background: { color: theme === "dark" ? "#0A0A0A" : "#F9F9F9" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: theme === "dark" ? "#1f1f1f" : "#eeeeee" },
        horzLines: { color: theme === "dark" ? "#1f1f1f" : "#eeeeee" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: theme === "dark" ? "#1f1f1f" : "#eeeeee",
      },
      timeScale: {
        borderColor: theme === "dark" ? "#1f1f1f" : "#eeeeee",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0FEDBE",
      downColor: "#F63C6B",
      borderUpColor: "#0FEDBE",
      borderDownColor: "#F63C6B",
      wickUpColor: "#0FEDBE",
      wickDownColor: "#F63C6B",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Load historical data first
    const loadHistoricalData = async () => {
      try {
        setStatus("Loading historical data...");
        const response = await fetch(
          "https://api.twelvedata.com/time_series?apikey=d1fb3cdd261d4aa2abce1adfb4427258&symbol=BTC/USD&interval=1min&outputsize=5000"
        );
        const data = await response.json();

        console.log("API Response:", data);

        if (!data.values || data.values.length === 0) {
          console.error("API returned an error:", data);
          const errorMsg = data.message || data.code || "No data available";
          setStatus("Error");
          setErrorMessage(errorMsg);
          return;
        }

        setErrorMessage(null);

        let candles: CandlestickData[] = data.values.map(
          (v: TwelveDataCandle) => {
            const utcTimestamp = Math.floor(
              Date.parse(v.datetime + "Z") / 1000
            );
            return {
              time: convertToLocalTime(utcTimestamp),
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
            };
          }
        );

        let volumes: HistogramData[] = data.values.map(
          (v: TwelveDataCandle) => {
            const utcTimestamp = Math.floor(
              Date.parse(v.datetime + "Z") / 1000
            );
            const open = parseFloat(v.open);
            const close = parseFloat(v.close);
            return {
              time: convertToLocalTime(utcTimestamp),
              value: parseFloat(v.volume),
              color:
                close >= open
                  ? "rgba(38, 166, 154, 0.5)"
                  : "rgba(239, 83, 80, 0.5)",
            };
          }
        );

        candles.sort((a, b) => (a.time as number) - (b.time as number));
        candles = candles.filter(
          (item, index: number, self) =>
            index === self.findIndex((t) => t.time === item.time)
        );
        volumes.sort((a, b) => (a.time as number) - (b.time as number));
        volumes = volumes.filter(
          (item, index: number, self) =>
            index === self.findIndex((t) => t.time === item.time)
        );

        candleSeries.setData(candles);
        // volumeSeries.setData(volumes);

        setIsHistoricalLoaded(true);
        setStatus("Connecting to live data...");

        // Get the last candle's close price
        if (candles.length > 0) {
          setCurrentPrice(candles[candles.length - 1].close);
        }
      } catch (error) {
        console.error("Error fetching historical data:", error);
        setStatus("Error");
        setErrorMessage(
          error instanceof Error ? error.message : "Network error"
        );
      }
    };

    loadHistoricalData();

    return () => {
      wsRef.current?.close();
      chart.remove();
    };
  }, [theme]);

  // WebSocket connection - starts after historical data is loaded
  useEffect(() => {
    if (!isHistoricalLoaded || !candleSeriesRef.current) return;

    const API_KEY = "d1fb3cdd261d4aa2abce1adfb4427258";
    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${API_KEY}`;

    let heartbeatInterval: NodeJS.Timeout | null = null;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket Connected ✅");
      setStatus("Live");

      ws.send(
        JSON.stringify({
          action: "subscribe",
          params: { symbols: "BTC/USD" },
        })
      );

      // HEARTBEAT - only send if connection is still open
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "heartbeat" }));
          console.log("Heartbeat sent");
        }
      }, 10000);
    };

    ws.onclose = (event) => {
      console.log("WebSocket Closed", event.code, event.reason);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      setStatus("Disconnected");
    };

    // Handle messages
    ws.onmessage = (msg) => {
      const data: PriceEvent = JSON.parse(msg.data);

      if (data.event === "price" && data.symbol === "BTC/USD") {
        const price = data.price;
        const timestamp = data.timestamp;
        const candleTime = getCandleTimestamp(timestamp);

        setCurrentPrice(price);

        // Check if we need to create a new candle or update existing one
        if (
          !currentCandleRef.current ||
          currentCandleRef.current.timestamp !== candleTime
        ) {
          // New candle
          currentCandleRef.current = {
            timestamp: candleTime,
            open: price,
            high: price,
            low: price,
            close: price,
            lastUpdate: timestamp,
          };
        } else {
          // Update existing candle
          currentCandleRef.current.high = Math.max(
            currentCandleRef.current.high,
            price
          );
          currentCandleRef.current.low = Math.min(
            currentCandleRef.current.low,
            price
          );
          currentCandleRef.current.close = price;
          currentCandleRef.current.lastUpdate = timestamp;
        }

        // Update chart
        const candleData: CandlestickData = {
          time: convertToLocalTime(candleTime) as Time,
          open: currentCandleRef.current.open,
          high: currentCandleRef.current.high,
          low: currentCandleRef.current.low,
          close: currentCandleRef.current.close,
        };

        candleSeriesRef.current?.update(candleData);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("Connection error");
    };

    return () => {
      console.log("Cleanup: Closing WebSocket");
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      ws.close();
    };
  }, [isHistoricalLoaded]);

  return (
    <div className="h-screen flex items-start">
      <style>{`
        #tv-attr-logo { display: none !important; }
      `}</style>
      <div className="bg-[var(--background)] rounded-3xl p-5 sm:p-10 mx-auto shadow-2xl w-[90%] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2 max-md:flex-col max-md:items-start">
              <h1 className="md:text-3xl text-base sm:text-xl font-bold text-foreground">
                BTC/USD
              </h1>
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold ${
                    status === "Live"
                      ? "bg-green-500/20 text-green-400 border border-green-500/50"
                      : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50"
                  }`}
                >
                  {status}
                </span>
              </div>
            </div>
            <span className="text-gray-400 md:text-lg text-xs sm:text-sm">
              Current Price:{" "}
              <span className="text-green-400">
                {currentPrice ? `$${currentPrice.toFixed(2)}` : "Loading..."}
              </span>{" "}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div className="relative w-full h-[70vh] overflow-hidden border-2 border-purple-400/30 rounded-xl">
          <div
            ref={chartContainerRef}
            className="absolute inset-0 w-full h-full"
          />
          {errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm z-10">
              <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-6 max-w-md text-center">
                <h3 className="text-red-400 font-bold text-lg mb-2">
                  Error Loading Data
                </h3>
                <p className="text-gray-400 mb-4">{errorMessage}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg text-red-400 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
