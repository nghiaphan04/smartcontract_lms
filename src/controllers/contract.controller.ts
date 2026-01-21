import { Request, Response } from 'express'
import { BlockfrostProvider, MeshWallet, policyId } from '@meshsdk/core'
import { APP_MNEMONIC, APP_NETWORK_ID, BLOCKFROST_API_KEY } from '../constants/enviroments.constant.js'
import { MeshTxBuilder } from '../txbuilders/mesh.txbuilder.js'

/**
 * @function mint
 * @description Handles minting a new on-chain asset on Cardano.
 * 1. Validates required fields: `asset_name`, `metadata`, `receiver`, and `course`.
 * 2. Initializes BlockfrostProvider to interact with the Cardano blockchain.
 * 3. Creates a MeshWallet instance using the app’s mnemonic.
 * 4. Uses MeshTxBuilder to build and sign a mint transaction.
 * 5. Submits the signed transaction to the blockchain and waits for confirmation.
 * 6. Returns transaction hash and success message as JSON.
 *
 * @param {Request} request - Express request containing asset details in the body.
 * @param {Response} response - Express response used to return transaction status.
 * @returns {Response} JSON with transaction hash and success/failure message.
 */
export const mint = async function (request: Request, response: Response) {
    console.log('=== MINT REQUEST ===')
    console.log('Request body:', request.body)
    try {
        const { course, asset_name, metadata, quantity = '1', receiver } = request.body
        if (!asset_name || !metadata || !receiver || !course) {
            console.log('ERROR: Missing required fields')
            return response.status(400).json({
                error: 'Missing required fields: asset_name, metadata, or receiver, course'
            })
        }

        console.log('Initializing BlockfrostProvider...')
        const blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY)

        const params = [
            {
                assetName: asset_name,
                metadata: metadata as Record<string, string>,
                quantity: quantity.toString(),
                receiver
            }
        ]

        console.log('Initializing MeshWallet...')
        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        })

        const changeAddress = await meshWallet.getChangeAddress()
        console.log('Change address:', changeAddress)

        console.log('Building transaction...')
        const meshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            course: course,
            issuer: changeAddress
        })
        
        console.log('Minting...')
        const unsignedTx = await meshTxBuilder.mint(params)
        
        console.log('Signing transaction...')
        const signedTx = await meshWallet.signTx(unsignedTx, true)
        
        console.log('Submitting transaction...')
        const txHash = await meshWallet.submitTx(signedTx)
        console.log('Transaction submitted:', txHash)
        
        console.log('Waiting for confirmation...')
        await new Promise<void>((resolve, reject) => {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log('Transaction confirmed!')
                resolve()
            })
        })
        
        const mintPolicyId = meshTxBuilder.policyId
        console.log('Policy ID:', mintPolicyId)
        console.log('=== MINT SUCCESS ===')
        return response.status(200).json({
            message: 'Asset minted successfully',
            tx_hash: txHash,
            policy_id: mintPolicyId,
            asset_name: asset_name,
            status: 202
        })
    } catch (error: any) {
        console.error('=== MINT ERROR ===')
        console.error('Error:', error.message || error)
        return response.status(500).json({
            error: 'Failed to mint asset',
            details: error.message || 'Unknown error',
            status: 500
        })
    }
}

export const batchMint = async function (request: Request, response: Response) {
    console.log('=== BATCH MINT REQUEST ===')
    try {
        const { course, items } = request.body
        
        if (!course || !items || !Array.isArray(items) || items.length === 0) {
            return response.status(400).json({
                error: 'Missing required fields: course, items (array)'
            })
        }

        if (items.length > 15) {
            return response.status(400).json({
                error: 'Maximum 15 items per batch (Cardano tx size limit)'
            })
        }

        for (const item of items) {
            if (!item.asset_name || !item.metadata || !item.receiver) {
                return response.status(400).json({
                    error: 'Each item must have: asset_name, metadata, receiver'
                })
            }
        }

        console.log(`Batch minting ${items.length} NFTs...`)
        const blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY)

        const params = items.map((item: any) => ({
            assetName: item.asset_name,
            metadata: item.metadata as Record<string, string>,
            quantity: (item.quantity || '1').toString(),
            receiver: item.receiver
        }))

        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        })

        const changeAddress = await meshWallet.getChangeAddress()
        
        const meshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            course: course,
            issuer: changeAddress
        })
        
        const unsignedTx = await meshTxBuilder.mint(params)
        const signedTx = await meshWallet.signTx(unsignedTx, true)
        const txHash = await meshWallet.submitTx(signedTx)
        
        console.log('Batch transaction submitted:', txHash)
        
        await new Promise<void>((resolve) => {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log('Batch transaction confirmed!')
                resolve()
            })
        })
        
        const mintPolicyId = meshTxBuilder.policyId
        console.log('=== BATCH MINT SUCCESS ===')
        
        return response.status(200).json({
            message: `${items.length} assets minted successfully`,
            tx_hash: txHash,
            policy_id: mintPolicyId,
            minted_count: items.length,
            asset_names: items.map((i: any) => i.asset_name),
            status: 202
        })
    } catch (error: any) {
        console.error('=== BATCH MINT ERROR ===')
        console.error('Error:', error.message || error)
        return response.status(500).json({
            error: 'Failed to batch mint assets',
            details: error.message || 'Unknown error',
            status: 500
        })
    }
}

/**
 * @function update
 * @description Updates the metadata of an existing on-chain asset.
 * 1. Validates required fields: `asset_name`, `metadata`, and `course`.
 * 2. Builds an update transaction using MeshTxBuilder.
 * 3. Signs and submits the transaction.
 * 4. Waits for blockchain confirmation and returns the transaction hash.
 *
 * @param {Request} request - Express request containing updated asset metadata.
 * @param {Response} response - Express response returning status and tx hash.
 */
export const update = async function (request: Request, response: Response) {
    try {
        const { course, asset_name, metadata } = request.body
        if (!asset_name || !metadata || !course) {
            return response.status(400).json({
                error: 'Missing required fields: asset_name, metadata, or receiver, course'
            })
        }

        const blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY)

        const params = [
            {
                assetName: asset_name,
                metadata: metadata as Record<string, string>
            }
        ]

        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        })

        const meshTxBuilder = new MeshTxBuilder({
            meshWallet,
            course: course,
            issuer: meshWallet.getChangeAddress()
        })
        const unsignedTx = await meshTxBuilder.update(params)
        const signedTx = await meshWallet.signTx(unsignedTx, true)
        const txHash = await meshWallet.submitTx(signedTx)
        await new Promise<void>((resolve, reject) => {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                resolve()
            })
        })
        return response.status(200).json({
            message: 'Asset minted successfully',
            tx_hash: txHash,
            status: 202
        })
    } catch (error: any) {
        return response.status(500).json({
            error: 'Failed to mint asset',
            details: error.message || 'Unknown error',
            status: 500
        })
    }
}

/**
 * @function burn
 * @description Burns (destroys) an existing on-chain asset.
 * 1. Validates `asset_name`, `quantity`, and `course`.
 * 2. Uses MeshTxBuilder to build a burn transaction.
 * 3. Signs and submits the transaction to the blockchain.
 * 4. Waits for confirmation before responding with the transaction hash.
 *
 * @param {Request} request - Express request containing asset burn details.
 * @param {Response} response - Express response returning transaction result.
 */
export const burn = async function (request: Request, response: Response) {
    try {
        const { course, asset_name, quantity } = request.body
        if (!asset_name || !quantity || !course) {
            return response.status(400).json({
                error: 'Missing required fields: asset_name, metadata, or receiver, course'
            })
        }

        const blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY)

        const params = [
            {
                assetName: asset_name,
                quantity: quantity
            }
        ]

        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        })

        const meshTxBuilder = new MeshTxBuilder({
            meshWallet,
            course: course,
            issuer: meshWallet.getChangeAddress()
        })
        const unsignedTx = await meshTxBuilder.burn(params)
        const signedTx = await meshWallet.signTx(unsignedTx, true)
        const txHash = await meshWallet.submitTx(signedTx)
        await new Promise<void>((resolve, reject) => {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                resolve()
            })
        })
        return response.status(200).json({
            message: 'Asset minted successfully',
            tx_hash: txHash,
            status: 202
        })
    } catch (error: any) {
        return response.status(500).json({
            error: 'Failed to mint asset',
            details: error.message || 'Unknown error',
            status: 500
        })
    }
}

/**
 * @function contract
 * @description Returns key information about the minting policy and store address for a given course.
 * 1. Validates that `course` is provided in the request body.
 * 2. Initializes wallet and transaction builder using Mesh SDK.
 * 3. Returns the policy ID and store address derived from the course contract.
 *
 * @param {Request} request - Express request containing `course` identifier.
 * @param {Response} response - Express response returning policy ID and store address.
 */
export const contract = async function (request: Request, response: Response) {
    try {
        const { course } = request.body
        if (!course) {
            return response.status(400).json({
                error: 'Missing required fields: asset_name, metadata, or receiver, course'
            })
        }

        const blockfrostProvider = new BlockfrostProvider(BLOCKFROST_API_KEY)

        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: 'mnemonic',
                words: APP_MNEMONIC?.split(' ') || []
            }
        })

        const meshTxBuilder = new MeshTxBuilder({
            meshWallet,
            course: course,
            issuer: meshWallet.getChangeAddress()
        })

        return response.status(200).json({
            message: 'Asset minted successfully',
            data: {
                policy_id: meshTxBuilder.policyId,
                store_address: meshTxBuilder.storeAddress
            },
            status: 200
        })
    } catch (error: any) {
        return response.status(500).json({
            error: 'Failed to mint asset',
            details: error.message || 'Unknown error',
            status: 500
        })
    }
}
