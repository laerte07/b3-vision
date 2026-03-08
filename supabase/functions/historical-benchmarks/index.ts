import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ────────────────────────────────────────────────

function parseBCBDate(dateStr: string): string {
  // DD/MM/YYYY → YYYY-MM-DD
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
  return data.results?.[0]?.historicalDataPrice ?? [];
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
      "IFIX",
      "IPCA",
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
          // BCB series 12: CDI annualized rate (% a.a.)
          // Convert to daily: daily = (1 + annual/100)^(1/252) - 1
          const data = await fetchBCBSeries(12, startDate, endDate);
          console.log(`[CDI] Got ${data.length} data points from BCB series 12`);

          let cumIndex = 1000;
          for (const row of data) {
            const annualRate = parseFloat(row.valor.replace(",", "."));
            if (isNaN(annualRate)) continue;
            const dailyRate = Math.pow(1 + annualRate / 100, 1 / 252) - 1;
            cumIndex *= 1 + dailyRate;
            records.push({
              benchmark_code: "CDI",
              benchmark_name: "CDI",
              date: parseBCBDate(row.data),
              value: parseFloat(cumIndex.toFixed(6)),
              source: "bcb_sgs_12",
              updated_at: now,
            });
          }
        } else if (code === "IPCA") {
          // BCB series 433: IPCA monthly variation (%)
          const data = await fetchBCBSeries(433, startDate, endDate);
          console.log(
            `[IPCA] Got ${data.length} data points from BCB series 433`
          );

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
          // BRAPI: ^BVSP (Ibovespa index)
          if (!brapiToken) {
            results[code] = { ok: false, error: "BRAPI_TOKEN required for IBOV" };
            continue;
          }
          const data = await fetchBRAPIHistorical("^BVSP", brapiToken, "5y");
          console.log(`[IBOV] Got ${data.length} data points from BRAPI`);

          for (const row of data) {
            if (!row.close || !row.date) continue;
            const date = new Date(row.date * 1000);
            records.push({
              benchmark_code: "IBOV",
              benchmark_name: "Ibovespa",
              date: date.toISOString().slice(0, 10),
              value: row.close,
              source: "brapi",
              updated_at: now,
            });
          }
        } else if (code === "IFIX") {
          // BRAPI: IFIX index
          if (!brapiToken) {
            results[code] = { ok: false, error: "BRAPI_TOKEN required for IFIX" };
            continue;
          }
          // Try IFIX first, fallback to IFIX11 (ETF proxy)
          let data: { date: number; close: number }[] = [];
          try {
            data = await fetchBRAPIHistorical("IFIX", brapiToken, "5y");
          } catch {
            console.log("[IFIX] Direct ticker failed, trying IFIX11 as proxy");
            try {
              data = await fetchBRAPIHistorical("IFIX11", brapiToken, "5y");
            } catch (e2) {
              throw new Error(
                `IFIX not available on BRAPI: ${(e2 as Error).message}`
              );
            }
          }
          console.log(`[IFIX] Got ${data.length} data points from BRAPI`);

          for (const row of data) {
            if (!row.close || !row.date) continue;
            const date = new Date(row.date * 1000);
            records.push({
              benchmark_code: "IFIX",
              benchmark_name: "IFIX",
              date: date.toISOString().slice(0, 10),
              value: row.close,
              source: "brapi",
              updated_at: now,
            });
          }
        }

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
