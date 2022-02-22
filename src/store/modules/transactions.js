import { buildClient } from "@/terra/client";
import {
  getBalance,
  getPool,
  getReverseSimulation,
  getSimulation,
  getTokenBalance,
  getTokenInfo,
  getWeights,
} from "@/terra/queries";
import { nativeTokenFromPair, saleAssetFromPair } from "@/helpers/asset_pairs";
import { Dec, Int } from "@terra-money/terra.js";
import {
  formatTokenAmount,
  fromFormattedString,
} from "@/helpers/number_formatters";
import { NATIVE_TOKEN_SYMBOLS } from "@/helpers/token_info";
import {
  buildSwapFromContractTokenMsg,
  buildSwapFromNativeTokenMsg,
  postMsg,
} from "@/terra/swap";
import { loading, success } from "@/terra/result";
import {
  baseFeedback,
  errorFeedback,
  successFeedback,
} from "@/components/ModalFeedback";
import { getController } from "@/controller";
import { UserDenied } from "@terra-money/wallet-provider";

let testnet = {
  URL: "https://bombay-lcd.terra.dev",
  chainID: "bombay-12",
  gasPrices: "0.15",
};

let mainnet = {
  URL: "https://lcd.terra.dev",
  chainID: "columbus-5",
  gasPrices: "0.15",
};

let isTestNet = false;
const networkConfig = isTestNet ? testnet : mainnet;
let terra = buildClient(networkConfig);

const state = {
  pageLoading: {
    isLoading: false,
    label: undefined,
    transaction: undefined,
  },
  isConnected: false,
  pageFeedback: baseFeedback(),
  walletAddress: "",
  balance: 0,
  tokenBalance: 0,
  currentPair: null,
  tokenAddress: null,
  tokenPrice: loading(),
  secondsRemaining: loading(),
  tokensRemaining: loading({ amount: 0, percentage: 0 }),
  currentLbpWeight: loading(),
  pairWeights: {},
  pool: {},
  saleTokenInfo: {},
  maxSwapFee: null,
};

const getters = {
  walletAddress: (state) => state.walletAddress,
  balance: (state) =>
    formatTokenAmount(state.walletAddress.length > 0 ? state.balance : 0, 6),
  tokenBalance: (state) =>
    formatTokenAmount(
      state.walletAddress.length > 0 ? state.tokenBalance : 0,
      6
    ),
  nativeTokenSymbol: (state) => {
    const denom = state.pair ? nativeTokenFromPair(state.pair).denom : "uusd";
    return NATIVE_TOKEN_SYMBOLS[denom];
  },
  tokenAddress: (state) => state.tokenAddress,
  tokenPrice: (state) => state.tokenPrice,
  tokensRemaining: (state) => state.tokensRemaining,
  currentLbpWeight: (state) => state.currentLbpWeight,
  pool: (state) => state.pool,
  currentPair: (state) => state.currentPair,
  secondsRemaining: (state) => state.secondsRemaining,
  saleTokenInfo: (state) => state.saleTokenInfo,
  pageLoading: (state) => state.pageLoading,
  pageFeedback: (state) => state.pageFeedback,
  priceHistory: (state) => () => {
    return {
      time: state.time,
      price: state.price,
      series: state.series,
    };
  },
  nativeAsset: (state) => {
    return {
      balance: getters.balance(state),
      symbol: getters.nativeTokenSymbol(state),
    };
  },
  tokenAsset: (state) => {
    return {
      balance: getters.tokenBalance(state),
      symbol: state.saleTokenInfo.symbol,
    };
  },
  maxSwapFee: (state) => state.maxSwapFee,
};

const mutations = {
  setPageLoading: (state, pageLoading) => (state.pageLoading = pageLoading),
  setPageFeedback: (state, pageFeedback) => (state.pageFeedback = pageFeedback),
  setWalletAddress: (state, walletAddress) =>
    (state.walletAddress = walletAddress),
  setBalance: (state, balance) => (state.balance = balance),
  setTokenBalance: (state, tokenBalance) => (state.tokenBalance = tokenBalance),
  setTokenPrice: (state, tokenPrice) => (state.tokenPrice = tokenPrice),
  setTokensRemaining: (state, tokensRemaining) =>
    (state.tokensRemaining = tokensRemaining),
  setCurrentLbpWeight: (state, currentLbpWeight) =>
    (state.currentLbpWeight = currentLbpWeight),
  setPairWeights: (state, pairWeights) => (state.pairWeights = pairWeights),
  setPool: (state, pool) => (state.pool = pool),
  setCurrentPair: (state, currentPair) => (state.currentPair = currentPair),
  setSecondsRemaining: (state, secondsRemaining) =>
    (state.secondsRemaining = secondsRemaining),
  setSaleTokenInfo: (state, saleTokenInfo) =>
    (state.saleTokenInfo = saleTokenInfo),
  setPriceHistory: (state, priceHistory) => {
    state.price = priceHistory.price;
    state.time = priceHistory.time;
    state.series = priceHistory.series;
  },
  setMaxSwapFee: (state, maxSwapFee) => (state.maxSwapFee = maxSwapFee),
  setTokenAddress: (state, tokenAddress) => (state.tokenAddress = tokenAddress),
};

const actions = {
  async initWallet({ getters }) {
    const controller = getController();
    if (getters.walletAddress === "") {
      controller.connect();
    } else {
      controller.disconnect();
    }
  },
  async observeWalletInformation({ commit, dispatch }) {
    const controller = getController();
    controller.states().subscribe({
      next(_walletConnected) {
        if (_walletConnected.status === "WALLET_CONNECTED") {
          commit("setPageLoading", {
            isLoading: true,
            label: "Connecting wallet...",
          });
          if (_walletConnected.network.chainID === networkConfig.chainID) {
            terra = buildClient({
              URL: _walletConnected.network.lcd,
              chainID: _walletConnected.network.chainID,
            });
            const wallet = _walletConnected.wallets[0].terraAddress;
            commit("setWalletAddress", wallet);
            dispatch("updateBalance");
            dispatch("fetchCurrentPair");
          } else {
            this.error();
          }
          commit("setPageLoading", { isLoading: false });
        } else {
          commit("setWalletAddress", "");
          commit("setTokenBalance", 0);
          commit("setBalance", 0);
          dispatch("fetchCurrentPair");
        }
      },
      error(e) {
        commit("setWalletAddress", "");
        commit("setPageLoading", { isLoading: false });
        commit(
          "setPageFeedback",
          errorFeedback({
            title: "Ooops...",
            message:
              "We had a problem connecting to your wallet. Make sure it is connected to the right network.",
          })
        );
        console.log(e);
      },
    });
  },
  async updateBalance({ dispatch, commit }) {
    const balance = await dispatch("fetchBalance");
    const tokenBalance = await dispatch("fetchTokenBalance");
    commit("setBalance", balance);
    commit("setTokenBalance", tokenBalance);
  },
  async fetchBalance({ getters }) {
    const walletAddress = getters.walletAddress;
    if (walletAddress.length !== 0) {
      const pair = getters.currentPair;
      const nativeToken = nativeTokenFromPair(pair.asset_infos).native_token
        .denom;
      return await getBalance(terra, nativeToken, walletAddress);
    }
  },
  async fetchTokenBalance({ getters }) {
    const walletAddress = getters.walletAddress;
    if (walletAddress.length !== 0) {
      const pair = getters.currentPair;
      const tokenAddress = saleAssetFromPair(pair.asset_infos).token
        .contract_addr;
      return await getTokenBalance(terra, tokenAddress, walletAddress);
    }
  },
  async fetchCurrentPair({ commit, dispatch }) {
    const currentPair = {
      asset_infos: [
        {
          token: {
            contract_addr: "terra1vchw83qt25j89zqwdpmdzj722sqxthnckqzxxp",
          },
        },
        {
          native_token: {
            denom: "uusd",
          },
        },
      ],
      token_code_id: 1796,
      factory_addr: "terra1fnywlw4edny3vw44x04xd67uzkdqluymgreu7g",
      init_params: null,
    };
    commit("setCurrentPair", currentPair);
    commit("setTokenAddress", currentPair.asset_infos[0].token.contract_addr);
    dispatch("fetchSaleTokenInfo");
    dispatch("fetchTokenPrice");
    dispatch("fetchMaxSwapFee");
  },
  async fetchSecondsRemaining({ getters, commit }) {
    const pair = getters.currentPair;
    const secondsRemaining = pair.end_time - Math.floor(Date.now() / 1000);

    commit(
      "setSecondsRemaining",
      success(secondsRemaining > 0 ? secondsRemaining : 0)
    );
  },
  async fetchSaleTokenInfo({ getters, commit, dispatch }) {
    const pair = getters.currentPair;
    const saleTokenAddress = saleAssetFromPair(pair.asset_infos).token
      .contract_addr;
    const saleTokenInfo = await getTokenInfo(terra, saleTokenAddress);
    commit("setSaleTokenInfo", saleTokenInfo);
    dispatch("fetchPool");
  },
  async fetchWeights({ getters, commit }) {
    const pair = getters.currentPair;
    const nativeToken = nativeTokenFromPair(pair.asset_infos).native_token
      .denom;
    const [nativeTokenWeight, saleTokenWeight] = await getWeights(
      terra,
      pair.contract_addr,
      nativeToken
    );
    const currentLbpWeight =
      nativeTokenWeight.toFixed(0) + " : " + saleTokenWeight.toFixed(0);

    commit("setPairWeights", { nativeTokenWeight, saleTokenWeight });
    commit("setCurrentLbpWeight", success(currentLbpWeight));
  },
  async fetchPool({ getters, commit }) {
    const pair = getters.currentPair;
    const pool = await getPool(terra, pair.contract_addr);
    commit("setPool", pool);

    const coinsRemaining = saleAssetFromPair(pool.assets).amount;
    const amount = coinsRemaining.slice(
      0,
      coinsRemaining.length - getters.saleTokenInfo.decimals
    );
    const totalSupply = getters.saleTokenInfo.total_supply;
    const percentage = Math.floor((coinsRemaining / totalSupply) * 100);
    commit("setTokensRemaining", success({ amount, percentage }));
  },
  async fetchTokenPrice({ dispatch, commit }) {
    const oneToken = new Dec(1).mul(10 ** 6).toInt();
    console.log("start reverse simulation");
    const reverseSimulationResult = await dispatch(
      "getReverseSimulation",
      oneToken
    );
    const tokenPrice = reverseSimulationResult.amount;
    commit("setTokenPrice", success(tokenPrice));
  },
  async fetchPriceHistory({ commit }) {
    //TODO: Cleanup
    let res = await fetch("https://price-api.localterra.money");
    let data = await res.json();
    let time = [];
    let price = [];
    let series = [];
    data.forEach((d) => {
      time.push(new Date(d.time));
      price.push((d.offer_amount / 1000000).toFixed(3));
      series.push([d.time, (d.offer_amount / 1000000).toFixed(3)]);
    });
    commit("setPriceHistory", { time, price, series });
  },
  async fetchMaxSwapFee({ getters, commit }) {
    const opts = {
      pair: getters.currentPair,
      walletAddress: getters.walletAddress,
      intBalance: parseInt(getters.balance.replace(/\D/g, "")),
    };
    const msg = buildSwapFromNativeTokenMsg({
      pair: opts.pair,
      walletAddress: opts.walletAddress,
      intAmount: new Int(1),
    });
    const info = await terra.auth.accountInfo(getters.walletAddress);
    const signerData = {
      sequenceNumber: info.sequence,
      publicKey: info.public_key,
    };
    const fee = await terra.tx.estimateFee([signerData], { msgs: [msg] });
    const gasPricesRes = await fetch("https://fcd.terra.dev/v1/txs/gas_prices");
    const gasPrices = await gasPricesRes.json();
    const maxSwapFee = fee.gas_limit * gasPrices.uusd;
    commit("setMaxSwapFee", maxSwapFee);
  },
  async getSimulation({ getters }, amount) {
    const pair = getters.currentPair;
    const assetInfo = nativeTokenFromPair(pair.asset_infos);
    console.log(assetInfo);
    const simulation = await getSimulation(
      terra,
      pair.contract_addr,
      amount,
      assetInfo
    );
    const returnAmount = Dec.withPrec(simulation["return_amount"], 6);
    const spread = Dec.withPrec(simulation["spread_amount"], 6);
    return { amount: returnAmount, spread };
  },
  async getReverseSimulation({ getters }, amount) {
    const pair = getters.currentPair;
    const assetInfo = saleAssetFromPair(pair.asset_infos);

    console.log(assetInfo);
    const simulation = await getReverseSimulation(
      terra,
      pair.contract_addr,
      amount,
      assetInfo
    );
    const returnAmount = Dec.withPrec(simulation["offer_amount"], 6);
    const spread = Dec.withPrec(simulation["spread_amount"], 6);
    return { amount: returnAmount, spread };
  },
  async swapTokens({ getters, dispatch, commit }, swapInfo) {
    let msg;
    let buildSwapOptions = {
      pair: getters.currentPair,
      walletAddress: getters.walletAddress,
      intAmount: swapInfo.fromAmount,
    };
    if (
      swapInfo.fromSymbol.toLowerCase() ===
      getters.nativeTokenSymbol.toLowerCase()
    ) {
      const balance = fromFormattedString(getters.balance)
        .mul(10 ** 6)
        .toNumber();

      //Deduct fees if amount + fees is higher than balance
      if (swapInfo.fromAmount + getters.maxSwapFee > balance) {
        buildSwapOptions.intAmount =
          balance - Math.ceil(getters.maxSwapFee * 1.1);
      }
      msg = buildSwapFromNativeTokenMsg(buildSwapOptions);
    } else if (
      swapInfo.fromSymbol.toLowerCase() ===
      getters.saleTokenInfo.symbol.toLowerCase()
    ) {
      msg = buildSwapFromContractTokenMsg(buildSwapOptions);
    } else {
      throw "Swapping from ?";
    }

    commit("setPageLoading", {
      isLoading: true,
      label: "Waiting for Terra Station",
    });
    postMsg(terra, { msg }).then(
      (result) => {
        const txInterval = setInterval(async () => {
          commit("setPageLoading", {
            isLoading: true,
            label: "Transaction hash:",
            transaction: result.txhash,
          });

          let txInfo = await terra.tx.txInfo(result.txhash);
          if (txInfo) {
            clearInterval(txInterval);
            dispatch("updateBalance");
            dispatch("fetchCurrentPair");
            commit("setPageLoading", { isLoading: false });
            commit("setPageFeedback", successFeedback({}));
          }
        }, 1000);
      },
      (e) => {
        if (!(e instanceof UserDenied)) {
          commit("setPageFeedback", errorFeedback({}));
        }
        commit("setPageLoading", { isLoading: false });
      }
    );
  },
};

export default {
  state,
  getters,
  actions,
  mutations,
};
