import {
  isArray,
  isNumber,
  isPlainObject,
  isString,
  PlainObject,
} from "is-what";
import { hooks, SemVer, semver, utils } from "libpkgx";
import useGitLabAPI from "./useGitLabAPI.ts";
import useGitHubAPI from "./useGitHubAPI.ts";
const { validate } = utils;

/// returns sorted versions
export default async function getVersions(
  spec: { project: string },
): Promise<SemVer[]> {
  const files = hooks.usePantry().project(spec);
  const versions = await files.yaml().then((x) => x.versions);
  return _parse(versions, spec.project);
}

export async function _parse(
  versions: unknown,
  project?: string,
): Promise<SemVer[]> {
  if (!isArray(versions)) versions = [versions];

  const result: Set<SemVer> = new Set<SemVer>();

  for (let v of versions as unknown[]) {
    let tempres: SemVer[] = [];
    if (isPlainObject(v)) {
      if (v.github) {
        tempres = await handleGitHubVersions(v);
      } else if (v.gitlab) {
        tempres = await handleGitLabVersions(v);
      } else if (v.npm) {
        tempres = await handleNPMVersions(v);
      } else if (v.url) {
        tempres = await handleURLVersions(v);
      } else {
        const keys = Object.keys(v);
        const first = keys.length > 0 ? keys[0] : "undefined";
        throw new Error(`Could not parse version scheme for ${first}`)
      }
      for (const ver of tempres) {
        result.add(ver);
      }
    } else {
      if (isNumber(v)) v = v.toString();
      const rv = isString(v) && semver.parse(v);
      if (!rv) throw new Error(`Could not parse versions for ${project}`);
      result.add(rv);
    }
  }

  return Array.from(result);
}

//SRC https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function handleGitHubVersions(versions: PlainObject): Promise<SemVer[]> {
  const [user, repo, ...types] = validate.str(versions.github).split("/");
  const type = types?.join("/").chuzzle() ?? "releases/tags";

  const ignore = parseIgnore(versions.ignore);
  const transform = (x => isString(x) ? x : undefined)(versions.transform);
  const strip = parseStrip(versions.strip);

  switch (type) {
    case "releases":
    case "releases/tags":
    case "tags":
      break;
    default:
      throw new Error();
  }

  const fetch = useGitHubAPI().getVersions({ user, repo, type });

  return handleAPIResponse({ fetch, ignore, strip, transform });
}

function handleGitLabVersions(versions: PlainObject): Promise<SemVer[]> {
  const [server, project, type] = (() => {
    let input = validate.str(versions.gitlab);
    const rv = [];

    if (input.includes(":")) {
      rv.push(input.split(":")[0]);
      input = input.split(":")[1];
    } else {
      rv.push("gitlab.com");
    }

    if (input.match(/\/(releases|tags)$/)) {
      const i = input.split("/");
      rv.push(i.slice(0, -1).join("/"));
      rv.push(i.slice(-1)[0]);
    } else {
      rv.push(input);
      rv.push("releases");
    }

    return rv;
  })();

  const ignore = parseIgnore(versions.ignore);

  const strip = parseStrip(versions.strip);

  switch (type) {
    case "releases":
    case "tags":
      break;
    default:
      throw new Error();
  }

  const fetch = useGitLabAPI().getVersions({ server, project, type });

  return handleAPIResponse({ fetch, ignore, strip });
}

function parseIgnore(ignore: string | string[] | undefined): RegExp[] {
  const arr = (() => {
    if (!ignore) return [];
    if (isString(ignore)) return [ignore];
    return validate.arr(ignore);
  })();
  return arr.map((input) => {
    let rx = validate.str(input);
    if (!(rx.startsWith("/") && rx.endsWith("/"))) {
      rx = escapeRegExp(rx);
      rx = rx.replace(/(x|y|z)\b/g, "\\d+");
      rx = `^${rx}$`;
    } else {
      rx = rx.slice(1, -1);
    }
    return new RegExp(rx);
  });
}

function parseStrip(
  strip: string | string[] | undefined,
): (x: string) => string {
  let s = strip;
  if (!s) return (x) => x;
  if (!isArray(s)) s = [s];
  // deno-lint-ignore no-explicit-any
  const rxs = s.map((rx: any) => {
    if (!isString(rx)) throw new Error();
    if (!(rx.startsWith("/") && rx.endsWith("/"))) throw new Error();
    return new RegExp(rx.slice(1, -1));
  });
  return (x) => {
    for (const rx of rxs) {
      x = x.replace(rx, "");
    }
    return x;
  };
}

interface APIResponseParams {
  // deno-lint-ignore no-explicit-any
  fetch: AsyncGenerator<{ version: string; tag?: string }, any, unknown>;
  ignore: RegExp[];
  strip: (x: string) => string;
  transform?: string | undefined;
}

async function handleAPIResponse({ fetch, ignore, strip, transform }: APIResponseParams): Promise<SemVer[]>
{
  const rv: SemVer[] = [];

  // if (transform) {
  //   handleTransformer({ transform }, fetch).then(x => rv.push(...x)
  // }

  const verstrs: string[] = []
  for await (const { version: pre_strip_name, tag } of fetch) {
    let name = strip(pre_strip_name);

    if (ignore.some((x) => x.test(name))) {
      console.debug({ ignoring: pre_strip_name, reason: "explicit" });
      continue;
    }

    if (!transform) {
      // An unfortunate number of tags/releases/other
      // replace the dots in the version with underscores.
      // This is parser-unfriendly, but we can make a
      // reasonable guess if this is happening.
      // But find me an example where this is wrong.
      if (name.includes("_") && !name.includes(".")) {
        name = name.replace(/_/g, ".");
      }

      // A fair number of tags or "versions" are just yyyy-mm-dd.
      // Since we're being permissive about underscores, we can
      // probably make the same kind of guess about dashes.
      if (name.includes("-") && !name.includes(".")) {
        name = name.replace(/-/g, ".");
      }
      const v = semver.parse(name);
      if (!v) {
        console.debug({ ignoring: pre_strip_name, reason: "unparsable" });
      } else if (v.prerelease.length <= 0) {
        console.debug({ found: v.toString(), from: pre_strip_name });
        // used by some packages
        (v as unknown as { tag: string }).tag = tag ?? pre_strip_name;
        rv.push(v);
      } else {
        console.debug({ ignoring: pre_strip_name, reason: "prerelease" });
      }
    } else {
      verstrs.push(name)
    }
  }

  if (transform) {
    rv.push(...await handleTransformer(transform, verstrs))
  }

  if (rv.length == 0) {
    console.warn("no versions parsed. Re-run with DEBUG=1 to see output.");
  }

  return rv;
}

async function handleURLVersions(versions: PlainObject): Promise<SemVer[]> {
  const rv: SemVer[] = [];
  const url = validate.str(versions.url);
  const matcher = validate.str(versions.match);

  const body = await fetch(url).then((x) => x.text());
  const matches = body.matchAll(new RegExp(matcher.slice(1, -1), "g"));

  const strip = versions.strip;
  for (const match of matches) {
    let m = ((x: string) => {
      if (!strip) return x;
      if (isString(strip)) return x.replace(new RegExp(strip.slice(1, -1)), "");
      if (isArray(strip)) {
        for (const rx of strip) {
          x = x.replace(new RegExp(rx.slice(1, -1)), "");
        }
        return x;
      }
      throw new Error();
    })(match[0]);

    // We'll handle dates > calver automatically. For now.
    const calver = m.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (calver) {
      m = `${calver[1]}.${calver[2]}.${calver[3]}`;
    }

    const v = semver.parse(m);
    // Lots of times the same string will appear as both the HREF and
    // the text of the link. We don't want to double count.
    if (v && !rv.find((vx) => vx.raw === v.raw)) rv.push(v);
  }
  return rv;
}

async function handleNPMVersions(versions: PlainObject): Promise<SemVer[]> {
  const rv: SemVer[] = [];
  const pkg = validate.str(versions.npm);
  const body = await fetch(`https://registry.npmjs.org/${pkg}`).then((x) =>
    x.json(),
  );
  const versions_ = body.versions;
  for (const v of Object.keys(versions_)) {
    if (versions.ignore?.includes(v)) continue;
    const ver = semver.parse(v);
    if (ver) rv.push(ver);
  }
  return rv;
}

import undent from "outdent"

async function handleTransformer(transform: string, versions: string[]): Promise<SemVer[]> {
  /// sadly deno built binaries cannot `eval` so we have to run a whole script 😕

  const cmd = new Deno.Command("pkgx", {
    args: ["deno", "run", "-"],
    stdin: "piped",
    stdout: "piped",
  }).spawn()

  const vv = versions.map(x => `"${x}"`).join(',')

  const writer = cmd.stdin!.getWriter()
  await writer.write(new TextEncoder().encode(undent`
    const transform = ${transform}
    for (const v of [${vv}]) {
      console.log(transform(v), v)
    }
    `));
  await writer.close()

  const { stdout: out, success: ok } = await cmd.output()

  if (!ok) throw new Error("failed to run version transformer")

  return new TextDecoder().decode(out).split('\n').compact(x => {
    const [transformed, original] = x.split(' ')
    const v = semver.parse(transformed)
    if (v) {
      (v as unknown as { tag: string }).tag = original
      return v
    }
  })
}
