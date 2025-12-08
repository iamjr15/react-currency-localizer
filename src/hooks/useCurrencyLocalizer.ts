import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useEffect } from 'react'
import type {
  GeolocationResponse,
  ExchangeRateResponse,
} from '../types'

/**
 * Configuration options for the useCurrencyLocalizer hook
 */
export interface UseCurrencyLocalizerOptions {
  /** The three-letter ISO 4217 code of the base currency (e.g., 'USD') */
  baseCurrency: string
  /** The API key obtained from exchangerate-api.com for fetching rates */
  apiKey: string
  /** A three-letter ISO 4217 code to manually specify the target currency, bypassing IP geolocation */
  manualCurrency?: string
  /** Custom geolocation endpoint URL (defaults to ipapi.co) */
  geoEndpoint?: string
  /** An optional callback function that fires when ready */
  onReady?: (localCurrency: string) => void
  /** An optional callback function that fires upon failure */
  onError?: (error: Error) => void
}

/**
 * Result object returned by the useCurrencyLocalizer hook
 */
export interface CurrencyLocalizerResult {
  /** Convert a price from base currency to local currency */
  convert: (price: number) => number | null
  /** Format a price in the local currency using Intl.NumberFormat */
  format: (price: number) => string
  /** Convert and format in one call */
  convertAndFormat: (price: number) => string
  /** The detected or manually set local currency code. null during loading */
  localCurrency: string | null
  /** The base currency code that was provided as input */
  baseCurrency: string
  /** The fetched exchange rate. null during loading or on error */
  exchangeRate: number | null
  /** True while either the geolocation or exchange rate data is being fetched */
  isLoading: boolean
  /** True when the converter is ready to use */
  isReady: boolean
  /** An Error object if one occurred, null otherwise */
  error: Error | null
}

const DEFAULT_GEO_ENDPOINT = 'https://ipapi.co/json/'

/**
 * A batch-friendly hook for currency conversion that provides converter functions.
 *
 * Unlike useCurrencyConverter which is designed for single price conversion,
 * this hook provides convert() and format() functions that can be called
 * multiple times without additional API calls.
 *
 * @example
 * ```tsx
 * const { convert, format, convertAndFormat, isReady } = useCurrencyLocalizer({
 *   baseCurrency: 'USD',
 *   apiKey: 'your-api-key',
 * })
 *
 * // Convert multiple prices efficiently
 * const prices = [9.99, 19.99, 29.99].map(convertAndFormat)
 * ```
 */
export const useCurrencyLocalizer = ({
  baseCurrency,
  apiKey,
  manualCurrency,
  geoEndpoint = DEFAULT_GEO_ENDPOINT,
  onReady,
  onError,
}: UseCurrencyLocalizerOptions): CurrencyLocalizerResult => {
  const upperBaseCurrency = baseCurrency.toUpperCase()
  const upperManualCurrency = manualCurrency?.toUpperCase()

  // Pre-emptive API key validation
  const apiKeyError = useMemo(() => {
    if (!apiKey || apiKey.trim() === '') {
      return new Error('API key is missing. Please provide a valid key from exchangerate-api.com.')
    }
    return null
  }, [apiKey])

  // Refs for callbacks
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onReadyRef.current = onReady
    onErrorRef.current = onError
  })

  // Geolocation Query
  const {
    data: geoData,
    error: geoError,
    isLoading: isGeoLoading,
  } = useQuery<GeolocationResponse, Error>({
    queryKey: ['geolocation', geoEndpoint],
    queryFn: async ({ signal }): Promise<GeolocationResponse> => {
      const response = await fetch(geoEndpoint, { signal })

      if (!response.ok) {
        throw new Error(`Geolocation API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(data.reason || 'Geolocation detection failed')
      }

      return {
        status: 'success',
        currency: data.currency,
        countryCode: data.country_code
      }
    },
    enabled: !upperManualCurrency && !apiKeyError,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const localCurrency = upperManualCurrency || geoData?.currency || null

  // Exchange Rate Query
  const {
    data: exchangeData,
    error: exchangeError,
    isLoading: isExchangeLoading,
  } = useQuery<ExchangeRateResponse, Error>({
    queryKey: ['exchange-rates', upperBaseCurrency, localCurrency],
    queryFn: async ({ signal }): Promise<ExchangeRateResponse> => {
      if (localCurrency === upperBaseCurrency) {
        return {
          result: 'success',
          base_code: upperBaseCurrency,
          conversion_rates: { [upperBaseCurrency]: 1 }
        }
      }

      const response = await fetch(
        `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${upperBaseCurrency}`,
        { signal }
      )

      if (!response.ok) {
        throw new Error(`Exchange rate API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.result === 'error') {
        throw new Error(
          data['error-message'] || `Exchange rate fetch failed: ${data.error_type}`
        )
      }

      return data
    },
    enabled: !!localCurrency && !apiKeyError,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const exchangeRate = localCurrency && exchangeData?.conversion_rates
    ? exchangeData.conversion_rates[localCurrency]
    : null

  const currencyMismatchError = useMemo(() => {
    if (localCurrency && exchangeData && exchangeData.conversion_rates && !(localCurrency in exchangeData.conversion_rates)) {
      return new Error(`Currency '${localCurrency}' was detected from your location but is not supported by the exchange rate provider.`)
    }
    return null
  }, [localCurrency, exchangeData])

  const isLoading = isGeoLoading || (isExchangeLoading && !!localCurrency)
  const error = geoError || exchangeError || currencyMismatchError || apiKeyError
  const isReady = !isLoading && !error && exchangeRate !== null

  // Memoized Intl.NumberFormat for performance
  const formatter = useMemo(() => {
    if (!localCurrency) return null
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: localCurrency,
      })
    } catch {
      return null
    }
  }, [localCurrency])

  const baseCurrencyFormatter = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: upperBaseCurrency,
      })
    } catch {
      return null
    }
  }, [upperBaseCurrency])

  // Converter function - memoized for stable reference
  const convert = useCallback((price: number): number | null => {
    if (typeof price !== 'number' || exchangeRate === null || currencyMismatchError) {
      return null
    }
    return price * exchangeRate
  }, [exchangeRate, currencyMismatchError])

  // Format function - memoized for stable reference
  const format = useCallback((price: number): string => {
    if (formatter) {
      return formatter.format(price)
    }
    if (baseCurrencyFormatter) {
      return baseCurrencyFormatter.format(price)
    }
    return `${price.toFixed(2)} ${localCurrency || upperBaseCurrency}`
  }, [formatter, baseCurrencyFormatter, localCurrency, upperBaseCurrency])

  // Combined convert and format
  const convertAndFormat = useCallback((price: number): string => {
    const converted = convert(price)
    if (converted !== null) {
      return format(converted)
    }
    // Fallback to base currency formatting
    if (baseCurrencyFormatter) {
      return baseCurrencyFormatter.format(price)
    }
    return `${price.toFixed(2)} ${upperBaseCurrency}`
  }, [convert, format, baseCurrencyFormatter, upperBaseCurrency])

  // Handle callbacks
  useEffect(() => {
    if (isReady && localCurrency && onReadyRef.current) {
      onReadyRef.current(localCurrency)
    }
  }, [isReady, localCurrency])

  useEffect(() => {
    if (!isLoading && error && onErrorRef.current) {
      onErrorRef.current(error)
    }
  }, [isLoading, error])

  return {
    convert,
    format,
    convertAndFormat,
    localCurrency,
    baseCurrency: upperBaseCurrency,
    exchangeRate: exchangeRate || null,
    isLoading,
    isReady,
    error: error || null,
  }
}
