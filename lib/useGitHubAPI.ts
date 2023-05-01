import { undent, validate_arr, validate_str } from "utils"
import { isArray, isString } from "is_what"

//TODO pagination

interface GetVersionsOptions {
  user: string
  repo: string
  type: 'releases' | 'tags' | 'releases/tags'
}

interface GHRelease {
  tag_name: string
  name: string
  created_at: Date
}

export default function useGitHubAPI() {
  return { getVersions }
}


async function GET2<T>(url: URL | string, headers?: Headers): Promise<[T, Response]> {
  if (isString(url)) url = new URL(url)
  if (url.host == "api.github.com") {
    const token = Deno.env.get("GITHUB_TOKEN")
    if (token) {
      headers ??= new Headers()
      headers.append("Authorization", `bearer ${token}`)
    }
  }
  const rsp = await fetch(url, { headers })
  if (!rsp.ok) throw new Error(`http: ${url}`)
  const json = await rsp.json()
  return [json as T, rsp]
}


async function *getVersions({ user, repo, type }: GetVersionsOptions): AsyncGenerator<string> {
  for await (const { version } of getVersionsLong({ user, repo, type })) {
    yield version
  }
}

async function *getVersionsLong({ user, repo, type }: GetVersionsOptions): AsyncGenerator<{ version: string, date: Date | undefined }> {
  //TODO set `Accept: application/vnd.github+json`
  //TODO we can use ETags to check if the data we have cached is still valid

  let ismore = false

  if (type.startsWith("releases")) {
    let page = 0
    do {
      page++
      const [json, rsp] = await GET2<GHRelease[]>(`https://api.github.com/repos/${user}/${repo}/releases?per_page=100&page=${page}`)
      if (!isArray(json)) throw new Error("unexpected json")
      for (const version of json.map(({ tag_name, name, created_at }) => ({
        version: type == 'releases/tags' ? tag_name : name,
        date: created_at }))) {
        yield version
      }

      const linkHeader = (rsp.headers as unknown as {link: string}).link
      ismore = linkHeader ? linkHeader.includes(`rel=\"next\"`) : false
    } while (ismore)
  } else {
    // GitHub tags API returns in reverse alphabetical order lol
    // so we have to use their graphql endpoint
    // sadly the graph ql endpoint requires auth :/

    //NOTE realistically the bad sort order for the REST api only effects ~5% of projects
    // so potentially could flag those projects (eg. go.dev)

    let before = "null"
    let returned = 0

    do {
      const headers: HeadersInit = {}
      const token = Deno.env.get("GITHUB_TOKEN")
      if (token) headers['Authorization'] = `bearer ${token}`

      const query = undent`
        query {
          repository(owner: "${user}", name: "${repo}") {
            refs(last: 100, before: ${before}, refPrefix: "refs/tags/", orderBy: {field: TAG_COMMIT_DATE, direction: ASC}) {
              nodes {
                name
                target {
                  ... on Commit {
                    committedDate
                  }
                }
              }
              pageInfo {
                hasPreviousPage
                startCursor
              }
            }
          }
        }`
      const rsp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query }),
        headers
      })
      const json = await rsp.json()

      if (!rsp.ok) {
        console.error({ rsp, json })
        throw new Error()
      }

      // deno-lint-ignore no-explicit-any
      const foo = validate_arr(json?.data?.repository?.refs?.nodes).map((x: any) => ({
          version: validate_str(x?.name),
          // some repos don't return the commits, like madler/zlib
          date: x?.target?.committedDate ? new Date(validate_str(x?.target?.committedDate)) : undefined
      }))

      for (const bar of foo) {
        returned += 1
        yield bar
      }

      if (returned >= 1000) {
        // That's enough. We've probably been running for 5s already
        ismore = false
        continue
      }

      ismore = json?.data?.repository?.refs?.pageInfo?.hasPreviousPage || false
      before = `"${json?.data?.repository?.refs?.pageInfo?.startCursor}"`

    } while (ismore)
  }
}