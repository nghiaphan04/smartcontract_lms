import {
    CIP68_100,
    CIP68_222,
    deserializeAddress,
    mConStr0,
    mConStr1,
    metadataToCip68,
    stringToHex,
    UTxO
} from '@meshsdk/core'
import { MeshAdapter } from '../adapters/mesh.adapter.js'
import { APP_NETWORK } from '../constants/enviroments.constant.js'
export class MeshTxBuilder extends MeshAdapter {
    /**
     * Mint new or existing CIP-68 tokens.
     *
     * @param params - Array of token minting parameters:
     *   - assetName: The name of the asset to mint.
     *   - metadata: Metadata object describing the asset (used for on-chain datum).
     *   - quantity: Amount of token to mint (default is "1").
     *   - receiver: Receiver address (defaults to current wallet address).
     * @param utxosInput - Optional list of input UTxOs to include in the transaction.
     *
     * @returns The completed unsigned transaction ready for signing.
     *
     * Logic Overview:
     * 1. Get wallet, UTxOs, and collateral information.
     * 2. Determine whether all assets are new or already exist (CIP68_100 state token).
     * 3. If both new and existing assets are mixed, throw an error (cannot handle both in one tx).
     * 4. If assets exist, validate ownership and mint additional CIP68_222 tokens.
     * 5. If assets are new, mint both CIP68_100 (state token) and CIP68_222 (user token),
     *    and attach metadata inline to the store address.
     * 6. Add all receiver outputs to the transaction.
     * 7. Finalize transaction by setting signer, collateral, change address, and network.
     */
    public mint = async (
        params: {
            assetName: string
            metadata: Record<string, string>
            quantity: string
            receiver: string
        }[],
        utxosInput?: UTxO[]
    ) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx()
        const unsignedTx = this.meshTxBuilder.mintPlutusScriptV3()
        if (utxosInput && Array.isArray(utxosInput)) {
            utxosInput.forEach((utxo) => {
                unsignedTx.txIn(utxo.input.txHash, utxo.input.outputIndex)
            })
        }
        const txOutReceiverMap = new Map<string, { unit: string; quantity: string }[]>()

        const assetsWithUtxo = await Promise.all(
            params.map(async ({ assetName }) => {
                const utxo = await this.getAddressUTXOAsset(
                    this.storeAddress,
                    this.policyId + CIP68_100(stringToHex(assetName))
                )
                return { assetName, hasPlutusData: !!utxo?.output?.plutusData, utxo }
            })
        )

        const allExist = assetsWithUtxo.every((asset) => asset.hasPlutusData)
        const allNew = assetsWithUtxo.every((asset) => !asset.hasPlutusData)

        if (!allExist && !allNew) {
            const existAssets = assetsWithUtxo.filter((asset) => asset.hasPlutusData).map((asset) => asset.assetName)
            throw new Error(
                `Transaction only supports either minting new or existing assets.\nAssets already exist: ${existAssets.join(', ')}`
            )
        }

        await Promise.all(
            params.map(async ({ assetName, metadata, quantity = '1', receiver = '' }) => {
                const existUtXOwithUnit = await this.getAddressUTXOAsset(
                    this.storeAddress,
                    this.policyId + CIP68_100(stringToHex(assetName))
                )
                if (allExist) {
                    const pk = await this.getPkHash(existUtXOwithUnit?.output?.plutusData as string)
                    if (pk !== deserializeAddress(walletAddress).pubKeyHash) {
                        throw new Error(`${assetName} has been exist`)
                    }
                    const receiverKey = receiver ? receiver : walletAddress
                    if (txOutReceiverMap.has(receiverKey)) {
                        txOutReceiverMap.get(receiverKey)!.push({
                            unit: this.policyId + CIP68_222(stringToHex(assetName)),
                            quantity: quantity
                        })
                    } else {
                        txOutReceiverMap.set(receiverKey, [
                            {
                                unit: this.policyId + CIP68_222(stringToHex(assetName)),
                                quantity: quantity
                            }
                        ])
                    }
                    unsignedTx
                        .mintPlutusScriptV3()
                        .mint(quantity, this.policyId, CIP68_222(stringToHex(assetName)))
                        .mintingScript(this.mintScriptCbor)
                        .mintRedeemerValue(mConStr0([]))
                } else if (allNew) {
                    const receiverKey = receiver ? receiver : walletAddress
                    if (txOutReceiverMap.has(receiverKey)) {
                        txOutReceiverMap.get(receiverKey)!.push({
                            unit: this.policyId + CIP68_222(stringToHex(assetName)),
                            quantity: quantity
                        })
                    } else {
                        txOutReceiverMap.set(receiverKey, [
                            {
                                unit: this.policyId + CIP68_222(stringToHex(assetName)),
                                quantity: quantity
                            }
                        ])
                    }

                    unsignedTx

                        .mintPlutusScriptV3()
                        .mint(quantity, this.policyId, CIP68_222(stringToHex(assetName)))
                        .mintingScript(this.mintScriptCbor)
                        .mintRedeemerValue(mConStr0([]))

                        .mintPlutusScriptV3()
                        .mint('1', this.policyId, CIP68_100(stringToHex(assetName)))
                        .mintingScript(this.mintScriptCbor)
                        .mintRedeemerValue(mConStr0([]))
                        .txOut(this.storeAddress, [
                            {
                                unit: this.policyId + CIP68_100(stringToHex(assetName)),
                                quantity: '1'
                            }
                        ])
                        .txOutInlineDatumValue(metadataToCip68(metadata))
                } else {
                    throw new Error(
                        `Transaction only supports either minting new assets or minting existing assets, not both in the same transaction`
                    )
                }
            })
        )
        txOutReceiverMap.forEach((assets, receiver) => {
            unsignedTx.txOut(receiver, assets)
        })

        unsignedTx
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .selectUtxosFrom(utxos)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address
            )
            .setNetwork(APP_NETWORK)
        return await unsignedTx.complete()
    }

    /**
     * Update existing CIP-68 metadata for assets stored at the store address.
     *
     * @param params - Array of objects with:
     *   - assetName: The name of the asset to update.
     *   - metadata: The new metadata to attach to the CIP68_100 datum.
     *   - txHash (optional): Specific transaction hash containing the UTxO to update.
     *
     * @returns The completed unsigned transaction.
     *
     * Logic Overview:
     * 1. Retrieve store UTxO (either by txHash or by asset name).
     * 2. Spend the old UTxO and recreate it with new metadata.
     * 3. Include necessary script, redeemer, and collateral setup.
     */
    public update = async (params: { assetName: string; metadata: Record<string, string>; txHash?: string }[]) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx()
        const unsignedTx = this.meshTxBuilder
        await Promise.all(
            params.map(async ({ assetName, metadata, txHash }) => {
                const storeUtxo = txHash
                    ? await this.getUtxoForTx(this.storeAddress, txHash)
                    : await this.getAddressUTXOAsset(
                          this.storeAddress,
                          this.policyId + CIP68_100(stringToHex(assetName))
                      )
                if (!storeUtxo) throw new Error('Store UTXO not found')
                unsignedTx
                    .spendingPlutusScriptV3()
                    .txIn(storeUtxo.input.txHash, storeUtxo.input.outputIndex)
                    .txInInlineDatumPresent() // Lấy datum ở utxo chi tiêu
                    // .spendingReferenceTxInInlineDatumPresent() // lấy datum ở utxo reference
                    .txInRedeemerValue(mConStr0([]))
                    .txInScript(this.storeScriptCbor)
                    .txOut(this.storeAddress, [
                        {
                            unit: this.policyId + CIP68_100(stringToHex(assetName)),
                            quantity: '1'
                        }
                    ])
                    .txOutInlineDatumValue(metadataToCip68(metadata))
            })
        )

        unsignedTx

            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .changeAddress(walletAddress)
            .selectUtxosFrom(utxos)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address
            )
            .setNetwork(APP_NETWORK)

        return await unsignedTx.complete()
    }

    /**
     * Burn existing CIP-68 tokens.
     *
     * @param params - Array of objects with:
     *   - assetName: The name of the token to burn.
     *   - quantity: Quantity to burn (negative number for burn).
     *   - txHash (optional): Transaction hash for the store UTxO.
     *
     * @returns The completed unsigned transaction.
     *
     * Logic Overview:
     * 1. Retrieve user's UTxOs holding CIP68_222 tokens.
     * 2. Calculate total token amount owned.
     * 3. Retrieve store UTxO for CIP68_100 (metadata state).
     * 4. If full burn (burning all), also remove the CIP68_100 token.
     * 5. Otherwise, only burn part of the CIP68_222 tokens.
     * 6. Set redeemers, minting scripts, and collateral for finalization.
     */
    public burn = async (params: { assetName: string; quantity: string; txHash?: string }[]) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx()
        const unsignedTx = this.meshTxBuilder
        await Promise.all(
            params.map(async ({ assetName, quantity, txHash }) => {
                const userUtxos = await this.getAddressUTXOAssets(
                    walletAddress,
                    this.policyId + CIP68_222(stringToHex(assetName))
                )
                const amount = userUtxos.reduce((amount, utxos) => {
                    return (
                        amount +
                        utxos.output.amount.reduce((amt, utxo) => {
                            if (utxo.unit === this.policyId + CIP68_222(stringToHex(assetName))) {
                                return amt + Number(utxo.quantity)
                            }
                            return amt
                        }, 0)
                    )
                }, 0)
                const storeUtxo = txHash
                    ? await this.getUtxoForTx(this.storeAddress, txHash)
                    : await this.getAddressUTXOAsset(
                          this.storeAddress,
                          this.policyId + CIP68_100(stringToHex(assetName))
                      )
                if (!storeUtxo) throw new Error('Store UTXO not found')

                if (-Number(quantity) === amount) {
                    unsignedTx
                        .mintPlutusScriptV3()
                        .mint(quantity, this.policyId, CIP68_222(stringToHex(assetName)))
                        .mintRedeemerValue(mConStr1([]))
                        .mintingScript(this.mintScriptCbor)

                        .mintPlutusScriptV3()
                        .mint('-1', this.policyId, CIP68_100(stringToHex(assetName)))
                        .mintRedeemerValue(mConStr1([]))
                        .mintingScript(this.mintScriptCbor)

                        .spendingPlutusScriptV3()
                        .txIn(storeUtxo.input.txHash, storeUtxo.input.outputIndex)
                        .txInInlineDatumPresent()
                        .txInRedeemerValue(mConStr1([]))
                        .txInScript(this.storeScriptCbor)
                } else {
                    unsignedTx
                        .mintPlutusScriptV3()
                        .mint(quantity, this.policyId, CIP68_222(stringToHex(assetName)))
                        .mintRedeemerValue(mConStr1([]))
                        .mintingScript(this.mintScriptCbor)

                        .txOut(walletAddress, [
                            {
                                unit: this.policyId + CIP68_222(stringToHex(assetName)),
                                quantity: String(amount + Number(quantity))
                            }
                        ])
                }
            })
        )

        unsignedTx

            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .changeAddress(walletAddress)
            .selectUtxosFrom(utxos)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address
            )
            .setNetwork(APP_NETWORK)

        return await unsignedTx.complete()
    }
}
