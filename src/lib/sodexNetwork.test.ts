import { describe, expect, it } from 'vitest';
import { getSodexBuilderConfig, getSodexNetworkConfig } from './sodexNetwork';

describe('getSodexNetworkConfig', () => {
  it('defaults to testnet and leaves it enabled', () => {
    const config = getSodexNetworkConfig({});
    expect(config.network).toBe('testnet');
    expect(config.chainId).toBe(138565);
    expect(config.spotUrl).toBe('https://testnet-gw.sodex.dev/api/v1/spot');
    expect(config.executionEnabled).toBe(true);
  });

  it('requires both explicit mainnet selection and the mainnet trading opt-in', () => {
    expect(getSodexNetworkConfig({ SODEX_USE_TESTNET: 'false' }).executionEnabled).toBe(false);
    expect(getSodexNetworkConfig({
      SODEX_USE_TESTNET: 'false',
      SODEX_ENABLE_MAINNET_TRADING: 'true',
    })).toMatchObject({
      network: 'mainnet',
      chainId: 286623,
      spotUrl: 'https://mainnet-gw.sodex.dev/api/v1/spot',
      executionEnabled: true,
    });
  });

  it('uses configured network endpoints and keeps the selected API base aligned', () => {
    const config = getSodexNetworkConfig({
      SODEX_USE_TESTNET: 'false',
      SODEX_ENABLE_MAINNET_TRADING: 'true',
      SODEX_MAINNET_SPOT_URL: 'https://gateway.example/api/v1/spot/',
      SODEX_MAINNET_RPC_URL: 'https://rpc.example',
    });
    expect(config.spotUrl).toBe('https://gateway.example/api/v1/spot');
    expect(config.apiUrl).toBe('https://gateway.example/api/v1');
    expect(config.rpcUrl).toBe('https://rpc.example');
  });
});

describe('getSodexBuilderConfig', () => {
  it('supports independent Testnet and Mainnet builder accounts', () => {
    const env = {
      SODEX_BUILDER_ID: '11',
      SODEX_BUILDER_FEE_RATE: '50',
      SODEX_MAINNET_BUILDER_ID: '22',
      SODEX_MAINNET_BUILDER_FEE_RATE: '30',
    };
    expect(getSodexBuilderConfig('testnet', env)).toEqual({ id: 11, maxFeeRate: 50 });
    expect(getSodexBuilderConfig('mainnet', env)).toEqual({ id: 22, maxFeeRate: 30 });
  });

  it('does not reuse Testnet builder IDs on Mainnet', () => {
    expect(getSodexBuilderConfig('mainnet', { SODEX_BUILDER_ID: '11' })).toBeUndefined();
  });

  it('rejects invalid IDs and rates', () => {
    expect(() => getSodexBuilderConfig('testnet', { SODEX_BUILDER_ID: '0' })).toThrow(/positive safe integer/);
    expect(() => getSodexBuilderConfig('testnet', {
      SODEX_BUILDER_ID: '11',
      SODEX_BUILDER_FEE_RATE: '2001',
    })).toThrow(/integer from 0 to 2000/);
  });
});
