import {type Transaction} from '@pages/gamepage/GamePageTypes'

/**
 * Sorterer alle nøkler i et objekt alfabetisk på en sikker og rekursiv måte.
 * Dette sikrer at JSON-strengen blir helt identisk uansett rekkefølge i minnet.
 */
function safeStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    
    if (Array.isArray(obj)) {
        // Beholder array-rekkefølgen intakt, men sikrer objekter inni arrayet
        return '[' + obj.map(safeStringify).join(',') + ']';
    }

    // Sorterer nøklene alfabetisk
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj: Record<string, any> = {};
    
    for (const key of sortedKeys) {
        // Går rekursivt nedover hvis verdien også er et objekt/array
        sortedObj[key] = obj[key];
    }
    
    return JSON.stringify(sortedObj);
}

/**
 * Genererer en sikker SHA-256 sjekksum fra en liste med transaksjoner.
 */
export async function generateTransactionsChecksum(transactions: Transaction[]): Promise<string> {
    // 1. Konverter listen til en deterministisk streng
    const standardizedString = safeStringify(transactions);

    // 2. Gjør strengen om til bytes
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(standardizedString);

    // 3. Beregn SHA-256 hash (asynkront via innebygd krypto)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);

    // 4. Konverter resultatet til en vanlig hex-streng
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
