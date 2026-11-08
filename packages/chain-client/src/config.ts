/**
 * Chain client configuration (VQ-12 / #13).
 *
 * The program id is the SAME throwaway placeholder as `declare_id!` in the
 * Anchor program — no keypair exists or is committed. Devnet deployment is
 * an explicit release gate (SOLANA_PROTOCOL §8); until it happens this
 * client's integration tests run against a LOCAL validator, and every
 * explorer link names the cluster it points at. No fabricated signatures.
 */

import { PublicKey } from "@solana/web3.js";

/** Matches declare_id! in programs/vorqyn/src/lib.rs (placeholder). */
export const PROGRAM_ID = new PublicKey("AHXUZz3HsnPjtUGdeg1VB4uyHN2WtVpkrQ2ZKgzX49dc");

export type Cluster = "localnet" | "devnet" | "mainnet-beta";

export interface ChainClientConfig {
  readonly cluster: Cluster;
  readonly rpcEndpoint: string;
}

export const CLUSTER_RPC: Readonly<Record<Cluster, string>> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export function configForCluster(cluster: Cluster, rpcEndpoint?: string): ChainClientConfig {
  return { cluster, rpcEndpoint: rpcEndpoint ?? CLUSTER_RPC[cluster] };
}

/** Truthful explorer deep link — always names the cluster (issue #13). */
export function explorerTxUrl(signature: string, cluster: Cluster): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
