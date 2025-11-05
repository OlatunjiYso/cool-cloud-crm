#!/usr/bin/env node

/**
 * cool-crm - Fetch company data from DealCloud CRM
 *
 * Usage:
 *   npm start "Company Name"
 *   or
 *   npx ts-node cool-crm.ts "Company Name"
 *
 * Example:
 *   npm start "SunTrust"
 */

import dotenv from 'dotenv'
import fetch from 'node-fetch'

dotenv.config();

// Configuration
const CONFIG = {
    baseUrl: process.env.DEALCLOUD_BASE_URL || 'https://resolve.dealcloud.com',
    clientId: process.env.DEALCLOUD_CLIENT_ID || "",
    clientSecret:
        process.env.DEALCLOUD_CLIENT_SECRET || '',
    entityId: process.env.DEALCLOUD_ENTITY_ID || ''
}

// Types
interface TokenResponse {
    access_token: string
    expires_in: number
    token_type: string
}

interface QueryResponse {
    rows: any[]
    totalRecords: number
}

interface CrmCompanyData {
    id: string
    crmType: 'SALESFORCE' | 'DEALCLOUD' | 'AFFINITY'
    matchedDomain?: string
    matchedName?: string
    crmUrl?: string
}

class DealCloudClient {
    private baseUrl: string
    private clientId: string
    private clientSecret: string
    private entityId: string

    constructor(config: typeof CONFIG) {
        this.baseUrl = config.baseUrl
        this.clientId = config.clientId
        this.clientSecret = config.clientSecret
        this.entityId = config.entityId
    }

    /**
     * Authenticate and get access token
     */
    async authenticate(): Promise<string> {
        const url = `${this.baseUrl}/api/rest/v1/oauth/token`
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
        const data = new URLSearchParams({
            scope: 'data',
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        })

        const response = await fetch(url, { method: 'POST', headers, body: data })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Authentication failed: ${response.status} - ${errorText}`)
        }

        const tokenData: TokenResponse = await response.json()
        return tokenData.access_token
    }

    /**
     * Query company by name
     */
    async getCompanyByName(companyName: string, accessToken: string): Promise<any | null> {
        const url = `${this.baseUrl}/api/rest/v4/data/entrydata/rows/query/${this.entityId}`
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
        const body = JSON.stringify({
            query: `{CompanyName: "${companyName.replace(/"/g, '\\"')}"}`,
            limit: 10,
            skip: 0,
            resolveReferenceUrls: true,
            wrapIntoArrays: true,
            fields: ['EntryId', 'CompanyName', 'Website', 'AccountOwner', 'Status']
        })

        const response = await fetch(url, { method: 'POST', headers, body })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Query failed: ${response.status} - ${errorText}`)
        }

        const result: QueryResponse = await response.json()

        if (!result.rows || result.rows.length === 0) {
            return null
        }

        // Find exact match (case-insensitive)
        const exactMatch = result.rows.find((row: any) => {
            const name =
                typeof row.CompanyName === 'string' ? row.CompanyName : row.CompanyName?.name
            return name?.toLowerCase() === companyName.toLowerCase()
        })

        return exactMatch || result.rows[0]
    }

    /**
     * Transform DealCloud response to CrmCompanyData format
     */
    transformToCrmData(dealCloudCompany: any, searchedName: string): CrmCompanyData {
        const entryId = dealCloudCompany.EntryId || dealCloudCompany.entryId || dealCloudCompany.id
        const companyName =
            typeof dealCloudCompany.CompanyName === 'string'
                ? dealCloudCompany.CompanyName
                : dealCloudCompany.CompanyName?.name || searchedName
        const website = dealCloudCompany.Website || null

        const crmData: CrmCompanyData = {
            id: String(entryId),
            crmType: 'DEALCLOUD',
            matchedName: companyName || searchedName || undefined,
            matchedDomain: website || undefined,
            crmUrl: entryId ? `${this.baseUrl}/#/Company/${entryId}` : undefined
        }

        return crmData
    }
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2)

    if (args.length === 0) {
        console.error('Usage: npm start "Company Name"')
        console.error('   or: npx ts-node cool-crm.ts "Company Name"')
        console.error('Example: npm start "SunTrust"')
        process.exit(1)
    }

    const companyName = args[0]

    try {
        // Initialize client
        const client = new DealCloudClient(CONFIG)

        // Authenticate
        process.stderr.write('Authenticating with DealCloud... ')
        const accessToken = await client.authenticate()
        process.stderr.write('✓\n')

        // Query company
        process.stderr.write(`Querying for "${companyName}"... `)
        const company = await client.getCompanyByName(companyName, accessToken)

        if (!company) {
            console.error(`\n✗ No company found matching "${companyName}"`)
            process.exit(1)
        }

        process.stderr.write('✓\n')

        // Transform to CrmCompanyData format
        const crmData = client.transformToCrmData(company, companyName)

        // Output JSON (to stdout for piping)
        console.log(JSON.stringify(crmData, null, 2))
    } catch (error: any) {
        console.error(`\n✗ Error: ${error.message}`)
        if (error.stack && process.env.DEBUG) {
            console.error(error.stack)
        }
        process.exit(1)
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error('Unhandled error:', error)
        process.exit(1)
    })
}
