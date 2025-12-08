// Main hook exports
export { useCurrencyConverter } from './hooks/useCurrencyConverter'
export { useCurrencyLocalizer } from './hooks/useCurrencyLocalizer'

// Component exports
export { LocalizedPrice } from './components/LocalizedPrice'

// Provider export
export { CurrencyConverterProvider } from './provider'

// Type exports
export type {
  UseCurrencyConverterOptions,
  CurrencyResult,
  GeolocationResponse,
  ExchangeRateResponse,
  LocalizedPriceProps,
  CurrencyConverterProviderProps,
} from './types'

// Export types from useCurrencyLocalizer
export type {
  UseCurrencyLocalizerOptions,
  CurrencyLocalizerResult,
} from './hooks/useCurrencyLocalizer'
