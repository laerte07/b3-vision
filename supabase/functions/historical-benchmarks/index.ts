import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ────────────────────────────────────────────────

function parseBCBDate(dateStr: string): string {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function formatBCBDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getFullYear()}`;
}

async function fetchBCBSeries(
  seriesCode: number,
  startDate: Date,
  endDate: Date
): Promise<{ data: string; valor: string }[]> {
  const start = formatBCBDate(startDate);
  const end = formatBCBDate(endDate);
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json&dataInicial=${start}&dataFinal=${end}`;
  console.log(`[BCB] Fetching series ${seriesCode}: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BCB HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`BCB unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// ─── Yahoo Finance ──────────────────────────────────────────

async function fetchYahooFinanceHistorical(
  ticker: string,
  range: string = "5y",
  interval: string = "1d"
): Promise<{ date: number; close: number }[]> {
  const enc = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=${range}&interval=${interval}`;
  console.log(`[Yahoo] Fetching: ${ticker}, range=${range}, interval=${interval}`);
  
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yahoo HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: no result for ${ticker}`);
  
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  
  const points: { date: number; close: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close != null && isFinite(close) && close > 0) {
      points.push({ date: timestamps[i], close });
    }
  }
  
  console.log(`[Yahoo] ${ticker}: got ${points.length} valid data points`);
  return points;
}

const YAHOO_RANGES = ["5y", "2y", "1y", "6mo", "3mo"];

async function fetchYahooWithFallback(
  ticker: string,
): Promise<{ date: number; close: number }[]> {
  for (const range of YAHOO_RANGES) {
    try {
      const data = await fetchYahooFinanceHistorical(ticker, range);
      if (data.length > 1) {
        console.log(`[Yahoo] ${ticker}: success with range=${range}, ${data.length} points`);
        return data;
      }
    } catch (e) {
      console.log(`[Yahoo] ${ticker}: range=${range} failed: ${(e as Error).message.slice(0, 100)}`);
      continue;
    }
  }
  return [];
}

// ─── BRAPI (fallback) ───────────────────────────────────────

async function fetchBRAPIHistorical(
  ticker: string,
  token: string,
  range: string
): Promise<{ date: number; close: number }[]> {
  const enc = encodeURIComponent(ticker);
  const url = `https://brapi.dev/api/quote/${enc}?range=${range}&interval=1d&token=${token}`;
  console.log(`[BRAPI] Fetching historical: ${ticker}, range=${range}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BRAPI HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const prices = data.results?.[0]?.historicalDataPrice ?? [];
  console.log(`[BRAPI] ${ticker}: got ${prices.length} data points`);
  return prices;
}

const BRAPI_RANGES = ["5y", "3mo", "1mo"];

async function fetchBRAPIWithFallback(
  ticker: string,
  token: string,
): Promise<{ date: number; close: number }[]> {
  for (const range of BRAPI_RANGES) {
    try {
      const data = await fetchBRAPIHistorical(ticker, token, range);
      if (data.length > 0) {
        console.log(`[BRAPI] ${ticker}: success with range=${range}, ${data.length} points`);
        return data;
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("INVALID_RANGE") || msg.includes("não está disponível")) {
        console.log(`[BRAPI] ${ticker}: range=${range} not available, trying next...`);
        continue;
      }
      throw e;
    }
  }
  return [];
}

// ─── Generic: convert timestamp+close array to records ──────

function toRecords(
  data: { date: number; close: number }[],
  benchmarkCode: string,
  benchmarkName: string,
  source: string,
  now: string,
) {
  const records: any[] = [];
  for (const row of data) {
    if (!row.close || !row.date) continue;
    const date = new Date(row.date * 1000);
    records.push({
      benchmark_code: benchmarkCode,
      benchmark_name: benchmarkName,
      date: date.toISOString().slice(0, 10),
      value: row.close,
      source,
      updated_at: now,
    });
  }
  return records;
}

// ─── Main handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const benchmarks: string[] = body.benchmarks ?? [
      "CDI",
      "IBOV",
      "IPCA",
      "SP500",
    ];

    const brapiToken = Deno.env.get("BRAPI_TOKEN") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5);

    const results: Record<string, any> = {};
    const now = new Date().toISOString();

    for (const code of benchmarks) {
      try {
        let records: any[] = [];

        if (code === "CDI") {
          const data = await fetchBCBSeries(12, startDate, endDate);
          console.log(`[CDI] Got ${data.length} data points from BCB series 12`);
          let cumIndex = 1000;
          for (const row of data) {
            const dailyRatePct = parseFloat(row.valor.replace(",", "."));
            if (isNaN(dailyRatePct)) continue;
            cumIndex *= (1 + dailyRatePct / 100);
            records.push({
              benchmark_code: "CDI",
              benchmark_name: "CDI",
              date: parseBCBDate(row.data),
              value: parseFloat(cumIndex.toFixed(6)),
              source: "bcb_sgs_12",
              updated_at: now,
            });
          }
          if (records.length > 0) {
            console.log(`[CDI] Cumulative index: start=1000, end=${cumIndex.toFixed(4)}`);
          }

        } else if (code === "IPCA") {
          const data = await fetchBCBSeries(433, startDate, endDate);
          console.log(`[IPCA] Got ${data.length} data points from BCB series 433`);
          let cumIndex = 1000;
          for (const row of data) {
            const monthlyRate = parseFloat(row.valor.replace(",", "."));
            if (isNaN(monthlyRate)) continue;
            cumIndex *= 1 + monthlyRate / 100;
            records.push({
              benchmark_code: "IPCA",
              benchmark_name: "IPCA",
              date: parseBCBDate(row.data),
              value: parseFloat(cumIndex.toFixed(6)),
              source: "bcb_sgs_433",
              updated_at: now,
            });
          }

        } else if (code === "IBOV") {
          console.log("[IBOV] Trying Yahoo Finance first...");
          let data = await fetchYahooWithFallback("^BVSP");
          let source = "yahoo";
          if (data.length <= 1 && brapiToken) {
            console.log("[IBOV] Yahoo insufficient, falling back to BRAPI...");
            data = await fetchBRAPIWithFallback("^BVSP", brapiToken);
            source = "brapi";
          }
          console.log(`[IBOV] Got ${data.length} data points from ${source}`);
          records = toRecords(data, "IBOV", "Ibovespa", source, now);

        } else if (code === "SP500") {
          // S&P 500 via Yahoo Finance (^GSPC) with SPY as fallback
          console.log("[SP500] Trying Yahoo Finance ^GSPC...");
          let data = await fetchYahooWithFallback("^GSPC");
          let source = "yahoo_gspc";

          if (data.length <= 1) {
            console.log("[SP500] ^GSPC insufficient, trying SPY...");
            data = await fetchYahooWithFallback("SPY");
            source = "yahoo_spy";
          }

          if (data.length <= 1 && brapiToken) {
            console.log("[SP500] Yahoo insufficient, trying BRAPI...");
            for (const ticker of ["^GSPC", "SPY"]) {
              try {
                data = await fetchBRAPIWithFallback(ticker, brapiToken);
                if (data.length > 1) { source = "brapi"; break; }
              } catch (e) {
                console.log(`[SP500] BRAPI ${ticker} failed: ${(e as Error).message}`);
              }
            }
          }

          console.log(`[SP500] Got ${data.length} data points from ${source}`);
          records = toRecords(data, "SP500", "S&P 500", source, now);
        }
        // IFIX removed — unreliable data source

        // Upsert in chunks
        if (records.length > 0) {
          const CHUNK = 500;
          let inserted = 0;
          for (let i = 0; i < records.length; i += CHUNK) {
            const chunk = records.slice(i, i + CHUNK);
            const { error } = await supabase
              .from("benchmark_history")
              .upsert(chunk, {
                onConflict: "benchmark_code,date",
                ignoreDuplicates: false,
              });
            if (error) throw error;
            inserted += chunk.length;
          }
          results[code] = { ok: true, fetched: records.length, inserted };
          console.log(`[${code}] Upserted ${inserted} records`);
        } else {
          results[code] = { ok: true, fetched: 0, inserted: 0 };
        }
      } catch (err) {
        console.error(`[${code}] Error:`, (err as Error).message);
        results[code] = { ok: false, error: (err as Error).message };
      }
    }

    console.log("[historical-benchmarks] Summary:", JSON.stringify(results));

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
