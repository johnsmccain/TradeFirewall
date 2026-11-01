import { SODEX_MAINNET_CHAIN_ID, SODEX_TESTNET_CHAIN_ID } from './sodexOrderSigning';

export type SodexNetwork = 'testnet' | 'mainnet';

export interface SodexNetworkConfig {
  network: SodexNetwork;
  chainId: number;
  spotUrl: string;
  apiUrl: string;
  rpcUrl: string;
  executionEnabled: boolean;
}

export function getSodexNetworkConfig(
  env: Record<string, string | undefined> = process.env
): SodexNetworkConfig {
  const network: SodexNetwork = (env.SODEX_USE_TESTNET ?? 'true').toLowerCase() === 'false'
    ? 'mainnet'
    : 'testnet';
  const spotUrl = (
    network === 'testnet'
      ? env.SODEX_TESTNET_SPOT_URL || 'https://testnet-gw.sodex.dev/api/v1/spot'
      : env.SODEX_MAINNET_SPOT_URL || 'https://mainnet-gw.sodex.dev/api/v1/spot'
  ).replace(/\/$/, '');
  const apiUrl = spotUrl.replace(/\/spot$/, '');

  return {
    network,
    chainId: network === 'testnet' ? SODEX_TESTNET_CHAIN_ID : SODEX_MAINNET_CHAIN_ID,
    spotUrl,
    apiUrl,
    rpcUrl: network === 'testnet'
      ? env.SODEX_TESTNET_RPC_URL || 'https://testnet.valuechain.xyz'
      : env.SODEX_MAINNET_RPC_URL || 'https://mainnet.valuechain.xyz',
    executionEnabled: network === 'testnet' || env.SODEX_ENABLE_MAINNET_TRADING === 'true',
  };
}

export function getSodexBuilderConfig(
  network: SodexNetwork,
  env: Record<string, string | undefined> = process.env
): { id: number; maxFeeRate: number } | undefined {
  const networkPrefix = network === 'testnet' ? 'SODEX_TESTNET' : 'SODEX_MAINNET';
  const idValue = env[`${networkPrefix}_BUILDER_ID`]?.trim()
    || (network === 'testnet' ? env.SODEX_BUILDER_ID?.trim() : undefined);
  if (!idValue) return undefined;

  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${networkPrefix}_BUILDER_ID must be a positive safe integer account ID.`);
  }

  const rateValue = env[`${networkPrefix}_BUILDER_FEE_RATE`]?.trim()
    || (network === 'testnet' ? env.SODEX_BUILDER_FEE_RATE?.trim() : undefined)
    || '50';
  if (!/^\d+$/.test(rateValue)) {
    throw new Error(`${networkPrefix}_BUILDER_FEE_RATE must be an integer from 0 to 2000.`);
  }
  const maxFeeRate = Number(rateValue);
  if (!Number.isSafeInteger(maxFeeRate) || maxFeeRate < 0 || maxFeeRate > 2000) {
    throw new Error(`${networkPrefix}_BUILDER_FEE_RATE must be an integer from 0 to 2000.`);
  }
  return { id, maxFeeRate };
}
