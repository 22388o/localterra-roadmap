export function saleAssetFromPair(asset_pair) {
  // We assume that one side is always a native token
  return asset_pair[0].token ? asset_pair[0] : asset_pair[1];
}

export function nativeTokenFromPair(asset_pair) {
  // We assume that one side is always a native token
  return asset_pair[0].native_token ? asset_pair[0] : asset_pair[1];
}
