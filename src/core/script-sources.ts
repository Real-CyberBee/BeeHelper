import { convertUserscript, parseUserscript, type ConvertedUserscript } from "./userscripts";

/** 用户脚本来源。ScriptCat（脚本站）在国内可直连；GreasyFork 作为可选来源。 */
export type ScriptSource = "scriptcat" | "greasyfork";
export type ScriptSort = "popular" | "trending" | "recent" | "score";

export const sourceLabels: Record<ScriptSource, string> = {
  scriptcat: "ScriptCat 脚本站",
  greasyfork: "GreasyFork"
};

export const sourceReady: Record<ScriptSource, string> = {
  scriptcat: "国内可直连，热门脚本与安装量实时同步",
  greasyfork: "全球最大的用户脚本站，部分网络环境可能无法直连"
};

export interface ScriptHit {
  source: ScriptSource;
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  totalInstalls?: number;
  dailyInstalls?: number;
  score?: number;
  scoreCount?: number;
  updatedAt?: number;
  pageUrl: string;
  iconUrl?: string;
  tags?: string[];
}

export interface ScriptSearchResult {
  source: ScriptSource;
  items: ScriptHit[];
  total?: number;
  cached?: boolean;
}

interface CacheEntry { at: number; result: ScriptSearchResult }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;
const TIMEOUT = 12_000;

const sortParams: Record<ScriptSource, Record<ScriptSort, string>> = {
  scriptcat: { popular: "total_download", trending: "trending", recent: "updatetime", score: "score" },
  greasyfork: { popular: "total_installs", trending: "daily_installs", recent: "updated", score: "rating" }
};

function limit(value: number | undefined, fallback = 20): number {
  return Math.max(1, Math.min(40, Math.round(value ?? fallback)));
}

async function getJson(url: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), credentials: "omit", headers: { accept: "application/json" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法访问脚本源（${new URL(url).host}）：${reason}。请检查网络或代理，或改用其他来源`);
  }
  if (!response.ok) throw new Error(`脚本源返回 ${response.status}，请稍后重试`);
  return response.json();
}

async function getText(url: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`下载脚本源码失败：${reason}`);
  }
}

function absolute(url: string | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:/i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function searchScriptCat(query: string, sort: ScriptSort, count: number): Promise<ScriptSearchResult> {
  const origin = "https://scriptcat.org";
  const params = new URLSearchParams({ page: "1", size: String(count), sort: sortParams.scriptcat[sort] });
  if (query) params.set("keyword", query);
  const data = await getJson(`${origin}/api/v2/scripts?${params.toString()}`);
  if (data?.code !== 0 || !Array.isArray(data?.data?.list)) throw new Error(data?.msg ? `脚本源返回：${data.msg}` : "脚本源返回了无法识别的数据");
  const items: ScriptHit[] = data.data.list.map((item: any) => ({
    source: "scriptcat" as const,
    id: String(item.id),
    name: String(item.name ?? "未命名脚本"),
    description: String(item.description ?? ""),
    author: item.username || undefined,
    version: item.script?.version || undefined,
    totalInstalls: Number(item.total_install) || 0,
    dailyInstalls: Number(item.today_install) || 0,
    score: Number(item.score) || undefined,
    scoreCount: Number(item.score_num) || undefined,
    updatedAt: Number(item.updatetime) ? Number(item.updatetime) * 1000 : undefined,
    pageUrl: `${origin}/zh-CN/script-show-page/${item.id}`,
    iconUrl: absolute(item.script?.meta_json?.icon?.[0] ?? item.avatar, origin),
    tags: Array.isArray(item.tags) ? item.tags.map((tag: any) => String(tag.name)).filter(Boolean).slice(0, 4) : []
  }));
  return { source: "scriptcat", items, total: Number(data.data.total) || undefined };
}

async function searchGreasyFork(query: string, sort: ScriptSort, count: number): Promise<ScriptSearchResult> {
  const params = new URLSearchParams({ sort: sortParams.greasyfork[sort] });
  if (query) params.set("q", query);
  const data = await getJson(`https://greasyfork.org/scripts.json?${params.toString()}`);
  if (!Array.isArray(data)) throw new Error("GreasyFork 返回了无法识别的数据");
  const items: ScriptHit[] = data.slice(0, count).map((item: any) => ({
    source: "greasyfork" as const,
    id: String(item.id),
    name: String(item.name ?? "未命名脚本"),
    description: String(item.description ?? ""),
    author: item.author?.name || undefined,
    version: item.version || undefined,
    totalInstalls: Number(item.total_installs) || 0,
    dailyInstalls: Number(item.daily_installs) || 0,
    score: Number(item.fan_score) || undefined,
    scoreCount: (Number(item.good_ratings) || 0) + (Number(item.bad_ratings) || 0) || undefined,
    updatedAt: item.code_updated_at ? Date.parse(item.code_updated_at) : undefined,
    pageUrl: String(item.url ?? `https://greasyfork.org/scripts/${item.id}`),
    iconUrl: item.icon_url || undefined,
    tags: []
  }));
  return { source: "greasyfork", items };
}

/** 搜索脚本；相同查询在 5 分钟内复用结果。 */
export async function searchUserscripts(source: ScriptSource, options: { query?: string; sort?: ScriptSort; limit?: number } = {}): Promise<ScriptSearchResult> {
  if (!(source in sortParams)) throw new Error("未知的脚本来源");
  const query = String(options.query ?? "").trim().slice(0, 80);
  const sort = options.sort ?? "popular";
  const count = limit(options.limit);
  const key = `${source}|${sort}|${count}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.result, cached: true };
  const result = source === "scriptcat" ? await searchScriptCat(query, sort, count) : await searchGreasyFork(query, sort, count);
  cache.set(key, { at: Date.now(), result });
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  return result;
}

/** 下载并转换一个脚本。返回微应用定义与导入限制说明。 */
export async function importUserscript(source: ScriptSource, id: string): Promise<ConvertedUserscript & { hit?: ScriptHit }> {
  if (!/^\d{1,12}$/.test(String(id))) throw new Error("脚本 id 不合法");
  let hit: ScriptHit | undefined;
  let text: string;
  let pageUrl: string;
  if (source === "scriptcat") {
    const detail = await getJson(`https://scriptcat.org/api/v2/scripts/${id}`);
    if (detail?.code !== 0 || !detail?.data) throw new Error(detail?.msg ? `脚本源返回：${detail.msg}` : "脚本不存在或已下架");
    const code = await getJson(`https://scriptcat.org/api/v2/scripts/${id}/code`);
    text = String(code?.data?.script?.code ?? "");
    if (!text) throw new Error("脚本源码为空，可能已被作者删除");
    pageUrl = `https://scriptcat.org/zh-CN/script-show-page/${id}`;
    hit = {
      source, id: String(id), name: String(detail.data.name ?? "未命名脚本"), description: String(detail.data.description ?? ""),
      author: detail.data.username || undefined, version: detail.data.script?.version || undefined,
      totalInstalls: Number(detail.data.total_install) || 0, pageUrl,
      iconUrl: absolute(detail.data.script?.meta_json?.icon?.[0], "https://scriptcat.org")
    };
  } else {
    const list = await getJson(`https://greasyfork.org/scripts/${id}.json`);
    const codeUrl = list?.code_url;
    if (!codeUrl) throw new Error("GreasyFork 未返回脚本源码地址");
    text = await getText(String(codeUrl));
    pageUrl = String(list.url ?? `https://greasyfork.org/scripts/${id}`);
    hit = {
      source, id: String(id), name: String(list.name ?? "未命名脚本"), description: String(list.description ?? ""),
      author: list.author?.name || undefined, version: list.version || undefined,
      totalInstalls: Number(list.total_installs) || 0, pageUrl, iconUrl: list.icon_url || undefined
    };
  }
  // 先解析一次，确保来源页面确实是用户脚本，再把真实元数据用于描述。
  const parsed = parseUserscript(text);
  const converted = convertUserscript(text, { source: sourceLabels[source], pageUrl, installs: hit?.totalInstalls, author: hit?.author, version: hit?.version });
  if (parsed.meta.name) hit = { ...hit!, name: parsed.meta.name };
  return { ...converted, hit };
}
