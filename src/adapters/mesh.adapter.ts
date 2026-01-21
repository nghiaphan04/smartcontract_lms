import {
    applyParamsToScript,
    BlockfrostProvider,
    deserializeAddress,
    IFetcher,
    ISubmitter,
    MeshTxBuilder,
    MeshWallet,
    PlutusScript,
    resolveScriptHash,
    scriptAddress,
    serializeAddressObj,
    serializePlutusScript,
    UTxO
} from '@meshsdk/core'
import cbor from 'cbor'
import { APP_NETWORK_ID, BLOCKFROST_API_KEY } from '~/constants/enviroments.constant.js'
import { Plutus } from '../types/index.js'
import plutus from '../../contracts/plutus.json' with { type: 'json' }
import { title } from '../constants/common.constant.js'

/**
 * @class MeshAdapter
 * @description
 * MeshAdapter is a helper class that provides a unified interface for
 * interacting with the Mesh SDK. It wraps key functionality such as:
 * - Initializing smart contract scripts (Plutus V3)
 * - Building and submitting transactions
 * - Fetching UTxOs and decoding Datum data
 *
 * This class is used primarily for Cardano smart contract operations
 * that require both `store` and `mint` scripts (parameterized with a course name and issuer).
 */
export class MeshAdapter {
    protected fetcher: IFetcher
    protected submitter: ISubmitter
    protected meshWallet: MeshWallet
    protected meshTxBuilder: MeshTxBuilder

    protected mintCompileCode: string
    protected mintScriptCbor: string
    protected mintScript: PlutusScript
    public policyId: string

    protected storeCompileCode: string
    protected storeScriptCbor: string
    protected storeScript: PlutusScript
    public storeAddress: string

    /**
     * @constructor
     * @description
     * Initializes the MeshAdapter with Cardano network providers (Blockfrost)
     * and parameterized Plutus scripts for both "store" and "mint".
     * The constructor automatically:
     * 1. Reads validator scripts from the provided Plutus JSON.
     * 2. Applies dynamic parameters like `course` and `issuer`.
     * 3. Computes the policy ID and script address for later transactions.
     *
     * @param {Object} params
     * @param {MeshWallet} [params.meshWallet] - Optional Mesh wallet instance used for signing.
     * @param {string} params.course - The course identifier used to parameterize the scripts.
     * @param {string} params.issuer - The Bech32 issuer address whose pubkey/stake hash are used in the scripts.
     */
    constructor({ meshWallet = null!, course, issuer }: { meshWallet?: MeshWallet; course: string; issuer: string }) {
        this.fetcher = new BlockfrostProvider(BLOCKFROST_API_KEY)
        this.submitter = new BlockfrostProvider(BLOCKFROST_API_KEY)
        this.meshWallet = meshWallet
        this.meshTxBuilder = new MeshTxBuilder({
            fetcher: this.fetcher,
            submitter: this.submitter
        })

        this.storeCompileCode = this.readValidator(plutus as Plutus, title.store)
        this.storeScriptCbor = applyParamsToScript(this.storeCompileCode, [
            course,
            deserializeAddress(issuer).pubKeyHash,
            deserializeAddress(issuer).stakeCredentialHash
        ])
        this.storeScript = {
            code: this.storeScriptCbor,
            version: 'V3'
        }
        this.storeAddress = serializeAddressObj(
            scriptAddress(
                deserializeAddress(serializePlutusScript(this.storeScript, undefined, APP_NETWORK_ID, false).address)
                    .scriptHash,
                deserializeAddress(issuer).stakeCredentialHash,
                false
            ),
            APP_NETWORK_ID
        )

        this.mintCompileCode = this.readValidator(plutus as Plutus, title.mint)
        this.mintScriptCbor = applyParamsToScript(this.mintCompileCode, [
            course,
            deserializeAddress(issuer).pubKeyHash,
            deserializeAddress(issuer).stakeCredentialHash,
            deserializeAddress(this.storeAddress).scriptHash,
            deserializeAddress(this.storeAddress).stakeCredentialHash
        ])
        this.mintScript = {
            code: this.mintScriptCbor,
            version: 'V3'
        }
        this.policyId = resolveScriptHash(this.mintScriptCbor, 'V3')
    }

    /**
     * @method getWalletForTx
     * @description
     * Fetches wallet-related data required for building transactions:
     * - UTxOs (Unspent Transaction Outputs)
     * - Collateral (used for Plutus scripts)
     * - Wallet change address
     *
     * Ensures all required elements exist before continuing.
     * Throws descriptive errors if data is missing.
     *
     * @returns {Promise<{ utxos: UTxO[], collateral: UTxO, walletAddress: string }>}
     */
    protected getWalletForTx = async (): Promise<{
        utxos: UTxO[]
        collateral: UTxO
        walletAddress: string
    }> => {
        const utxos = await this.meshWallet.getUtxos()
        const collaterals = await this.meshWallet.getCollateral()
        const walletAddress = await this.meshWallet.getChangeAddress()
        if (!utxos || utxos.length === 0) throw new Error('No UTXOs found in getWalletForTx method.')
        if (!collaterals || collaterals.length === 0) throw new Error('No collateral found in getWalletForTx method.')
        if (!walletAddress) throw new Error('No wallet address found in getWalletForTx method.')
        return { utxos, collateral: collaterals[0], walletAddress }
    }

    /**
     * @method readValidator
     * @description
     * Retrieves the compiled validator code (Base16 string) from a loaded Plutus JSON file.
     * Used internally by the constructor to get the "store" and "mint" scripts.
     *
     * @param {Plutus} plutus - The Plutus JSON definition.
     * @param {string} title - The name (key) of the validator to extract.
     * @returns {string} Compiled validator code.
     * @throws Error if the validator is not found in the JSON.
     */
    protected readValidator = function (plutus: Plutus, title: string): string {
        const validator = plutus.validators.find(function (validator) {
            return validator.title === title
        })

        if (!validator) {
            throw new Error(`${title} validator not found.`)
        }

        return validator.compiledCode
    }

    /**
     * @method getAddressUTXOAsset
     * @description
     * Fetches the latest (most recent) UTxO containing a specific asset from a given address.
     * Typically used to find a particular NFT or token at an address.
     *
     * @param {string} address - Bech32 Cardano address.
     * @param {string} unit - Asset unit (policyId + assetName in hex).
     * @returns {Promise<UTxO>} The most recent UTxO holding the specified asset.
     */
    protected getAddressUTXOAsset = async (address: string, unit: string) => {
        const utxos = await this.fetcher.fetchAddressUTxOs(address, unit)
        return utxos[utxos.length - 1]
    }

    /**
     * @method getAddressUTXOAssets
     * @description
     * Fetches all UTxOs that contain a specific asset at the provided address.
     * Useful when multiple tokens or copies of the same asset exist at one address.
     *
     * @param {string} address - Bech32 Cardano address.
     * @param {string} unit - Asset unit (policyId + assetName).
     * @returns {Promise<UTxO[]>} List of matching UTxOs.
     */
    protected getAddressUTXOAssets = async (address: string, unit: string) => {
        return await this.fetcher.fetchAddressUTxOs(address, unit)
    }

    /**
     * @method getUtxoForTx
     * @description
     * Finds a specific UTxO based on its transaction hash at a given address.
     * Commonly used for referencing a previously known transaction output.
     *
     * @param {string} address - The address to search within.
     * @param {string} txHash - The transaction hash to match.
     * @returns {Promise<UTxO>} The matching UTxO object.
     * @throws Error if the UTxO is not found.
     */
    protected getUtxoForTx = async (address: string, txHash: string) => {
        const utxos: UTxO[] = await this.fetcher.fetchAddressUTxOs(address)
        const utxo = utxos.find(function (utxo: UTxO) {
            return utxo.input.txHash === txHash
        })

        if (!utxo) throw new Error('No UTXOs found in getUtxoForTx method.')
        return utxo
    }

    /**
     * @method convertDatum
     * @description
     * Decodes a CBOR-encoded datum into a JavaScript object.
     * Optionally excludes the `_pk` field if `contain_pk` is false.
     *
     * @param {string} datum - Datum in hex string format.
     * @param {Object} [option] - Optional settings.
     * @param {boolean} [option.contain_pk] - Whether to include the `_pk` field.
     * @returns {Promise<Record<string, string>>} A decoded key-value map.
     * @throws Error if the datum format is invalid.
     */
    protected convertDatum = async (
        datum: string,
        option?: {
            contain_pk?: boolean
        }
    ): Promise<unknown> => {
        const cborDatum: Buffer = Buffer.from(datum, 'hex')
        const datumMap = (await cbor.decodeFirst(cborDatum)).value[0]
        if (!(datumMap instanceof Map)) {
            throw new Error('Invalid Datum')
        }
        const obj: Record<string, string> = {}
        datumMap.forEach((value, key) => {
            const keyStr = key.toString('utf-8')
            if (keyStr === '_pk' && !option?.contain_pk) {
                return
            }
            obj[keyStr] = keyStr !== '_pk' ? value.toString('utf-8') : value.toString('hex')
        })
        return obj
    }

    /**
     * @method getPkHash
     * @description
     * Extracts and returns the `_pk` (public key hash) field from a CBOR datum.
     * If the field is not found, returns `null`.
     *
     * @param {string} datum - Datum in hex format.
     * @returns {Promise<string | null>} Public key hash in hex or null if missing.
     */
    protected getPkHash = async (datum: string) => {
        const cborDatum: Buffer = Buffer.from(datum, 'hex')
        const decoded = await cbor.decodeFirst(cborDatum)
        for (const [key, value] of decoded.value[0]) {
            if (key.toString('utf-8') === '_pk') {
                return value.toString('hex')
            }
        }
        return null
    }

    /**
     * @method convertToKeyValue
     * @description
     * Converts an array of `{ k, v }` byte objects (Plutus-style key-value pairs)
     * into a standard JavaScript object with UTF-8 keys and string values.
     *
     * @param {Array<{ k: { bytes: string }, v: { bytes: string } }>} data - Array of key-value pairs.
     * @returns {Record<string, string>} A key-value mapping.
     */
    protected convertToKeyValue = (data: { k: { bytes: string }; v: { bytes: string } }[]): Record<string, string> => {
        return Object.fromEntries(
            data.map(({ k, v }) => {
                const key = Buffer.from(k.bytes, 'hex').toString('utf-8')
                const value = key === '_pk' ? v.bytes : Buffer.from(v.bytes, 'hex').toString('utf-8')
                return [key, value]
            })
        )
    }
}
