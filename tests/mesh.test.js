/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, test, beforeEach, jest } from '@jest/globals';
import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';
import { APP_MNEMONIC, APP_NETWORK_ID, BLOCKFROST_API_KEY } from '../src/constants/enviroments.constant';
import { MeshTxBuilder } from '../src/txbuilders/mesh.txbuilder';
describe('Mint, Burn, Update, Remove Course User (NFT/TOKEN) Using CIP68', function () {
    let meshWallet;
    let blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY);
    beforeEach(async function () {
        meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        });
    });
    jest.setTimeout(600000000);
    test('Mint', async function () {
        return;
        const meshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            course: '[C2VN]: Hydra on Cardano – Complete Step-by-Step DApp Guide',
            issuer: meshWallet.getChangeAddress()
        });
        const unsignedTx = await meshTxBuilder.mint([
            {
                assetName: '1hcd11',
                quantity: '1',
                receiver: '',
                metadata: {
                    name: 'hcd #009',
                    image: 'ipfs://QmQK3ZfKnwg772ZUhSodoyaqTMPazG2Ni3V4ydifYaYzdV',
                    mediaType: 'image/png',
                    rarity: 'Legendary'
                }
            }
        ]);
        const signedTx = await meshWallet.signTx(unsignedTx, true);
        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise(function (resolve, reject) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log('https://preview.cexplorer.io/tx/' + txHash);
                resolve();
            });
        });
    });
    test('Update', async function () {
        return;
        const meshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            course: '[C2VN]: Hydra on Cardano – Complete Step-by-Step DApp Guide',
            issuer: meshWallet.getChangeAddress()
        });
        const unsignedTx = await meshTxBuilder.update([
            {
                assetName: '1hcd11',
                metadata: {
                    name: 'hcd #009',
                    image: 'ipfs://QmQK3ZfKnwg772ZUhSodoyaqTMPazG2Ni3V4ydifYaYzdV',
                    mediaType: 'image/png',
                    rarity: 'Legendary'
                }
            }
        ]);
        const signedTx = await meshWallet.signTx(unsignedTx, true);
        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise(function (resolve, reject) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log('https://preview.cexplorer.io/tx/' + txHash);
                resolve();
            });
        });
    });
    test('Burn', async function () {
        return;
        const meshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            course: '[C2VN]: Hydra on Cardano – Complete Step-by-Step DApp Guide',
            issuer: meshWallet.getChangeAddress()
        });
        const unsignedTx = await meshTxBuilder.burn([
            {
                assetName: '1hcd11',
                quantity: '1'
            }
        ]);
        const signedTx = await meshWallet.signTx(unsignedTx, true);
        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise(function (resolve, reject) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log('https://preview.cexplorer.io/tx/' + txHash);
                resolve();
            });
        });
    });
});
