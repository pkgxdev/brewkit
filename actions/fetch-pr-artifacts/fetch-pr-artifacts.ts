#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write=./artifacts.tgz

/// Test
/// ./scripts/fetch-pr-artifacts.ts e582b03fe6efedde80f9569403555f4513dbec91

import undent from "outdent"
import { utils } from "tea"
const { panic } = utils
import { S3 } from "s3"

/// Main
/// -------------------------------------------------------------------------------

if (import.meta.main) {
  const usage = "usage: fetch-pr-artifacts.ts {REPO} {SHA} {platform+arch}"
  const repo = Deno.args[0] ?? panic(usage)
  const ref = Deno.args[1] ?? panic(usage)
  const flavor = Deno.args[2] ?? panic(usage)

  const pr = await find_pr(repo, ref)

  if (!pr) throw new Error(`No PR found for commit ${ref} in ${repo}`)

  const s3 = new S3({
    accessKeyID: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
    region: "us-east-1",
  })
  const bucket = s3.getBucket(Deno.env.get("AWS_S3_BUCKET")!)

  const key = `pull-request/${repo.split("/")[1]}/${pr}/${flavor}`
  const artifacts = (await bucket.getObject(key)) ?? panic("No artifacts found")

  const file = await Deno.open("artifacts.tgz", { create: true, write: true })
  await artifacts.body.pipeTo(file.writable)

  Deno.stdout.write(new TextEncoder().encode(`PR=${pr}`))
}

/// Functions
/// -------------------------------------------------------------------------------

export async function find_pr(repo: string, ref: string): Promise<number | undefined> {
  const res = await queryGraphQL<CommitQuery>(prQuery(repo))

  const node = res.repository?.ref?.target?.history?.edges.find(n => n.node.oid === ref)
  const nodes = node?.node.associatedPullRequests.nodes
  if (!nodes || nodes.length === 0) return
  return nodes[0].number
}

async function queryGraphQL<T>(query: string): Promise<T> {
  const headers: HeadersInit = {}
  const token = Deno.env.get("GITHUB_TOKEN") ?? panic("GitHub GraphQL requires you set $GITHUB_TOKEN")
  if (token) headers['Authorization'] = `bearer ${token}`

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

  return json.data as T ?? panic("No `data` returns from GraphQL endpoint")
}

/// Types
/// -------------------------------------------------------------------------------

type CommitQuery = {
  repository: {
    ref: {
      target: {
        history: {
          edges: Node[]
        }
      }
    }
  }
}

type Node = {
  node: {
    url: URL
    oid: string
    associatedPullRequests: { nodes: PullRequest[] }
  }
}

type PullRequest = {
  number: number
}

/// Queries
/// -------------------------------------------------------------------------------

function prQuery(repo: string): string {
  const [owner, name] = repo.split("/")
  return undent`
    query {
      repository(name: "${name}", owner: "${owner}") {
        ref(qualifiedName: "main") {
          target {
            ... on Commit {
              history(first: 100) {
                edges {
                  node {
                    url
                    oid
                    associatedPullRequests(first: 1) {
                      nodes {
                        number
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`
}