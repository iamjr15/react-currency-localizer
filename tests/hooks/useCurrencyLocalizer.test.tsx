import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCurrencyLocalizer } from '../../src/hooks/useCurrencyLocalizer'
import { createFetchMock, createFetchErrorMock } from '../__mocks__/fetch'

// Create wrapper component for QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0
      }
    }
  })

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useCurrencyLocalizer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should return converter functions and initial state', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key'
        }),
        { wrapper: createWrapper() }
      )

      // Should have all the expected functions and state
      expect(typeof result.current.convert).toBe('function')
      expect(typeof result.current.format).toBe('function')
      expect(typeof result.current.convertAndFormat).toBe('function')
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isReady).toBe(false)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.isReady).toBe(true)
      expect(result.current.localCurrency).toBe('USD')
      expect(result.current.exchangeRate).toBe(1)
    })
  })

  describe('convert function', () => {
    it('should convert multiple prices without additional API calls', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          manualCurrency: 'GBP'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Convert multiple prices - should all use cached exchange rate
      expect(result.current.convert(100)).toBe(74) // 100 * 0.74
      expect(result.current.convert(50)).toBe(37) // 50 * 0.74
      expect(result.current.convert(200)).toBe(148) // 200 * 0.74
      expect(result.current.convert(0)).toBe(0)
      expect(result.current.convert(-25)).toBe(-18.5) // -25 * 0.74
    })

    it('should return null when not ready', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key'
        }),
        { wrapper: createWrapper() }
      )

      // Before data loads, convert should return null
      expect(result.current.convert(100)).toBeNull()

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // After ready, should return converted value
      expect(result.current.convert(100)).toBe(100)
    })
  })

  describe('format function', () => {
    it('should format prices using memoized Intl.NumberFormat', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          manualCurrency: 'EUR'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Format should return properly formatted string
      const formatted = result.current.format(88)
      expect(formatted).toContain('88')
      expect(formatted).toMatch(/€|EUR/) // Should have Euro symbol or code
    })
  })

  describe('convertAndFormat function', () => {
    it('should convert and format in one call', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          manualCurrency: 'GBP'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      const formatted = result.current.convertAndFormat(100)
      // Should convert 100 USD to 74 GBP and format
      expect(formatted).toContain('74')
      expect(formatted).toMatch(/£|GBP/)
    })

    it('should fallback to base currency formatting when not ready', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key'
        }),
        { wrapper: createWrapper() }
      )

      // Before ready, should format in base currency
      const formatted = result.current.convertAndFormat(100)
      expect(formatted).toContain('100')
    })
  })

  describe('custom geoEndpoint', () => {
    it('should use custom geolocation endpoint when provided', async () => {
      const customEndpoint = 'https://custom-geo.example.com/json'
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === customEndpoint) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              currency: 'JPY',
              country_code: 'JP'
            })
          })
        }
        if (url.includes('exchangerate-api.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: 'success',
              base_code: 'USD',
              conversion_rates: { JPY: 150, USD: 1 }
            })
          })
        }
        return Promise.reject(new Error('Unknown URL'))
      })
      global.fetch = fetchMock

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          geoEndpoint: customEndpoint
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(fetchMock).toHaveBeenCalledWith(customEndpoint, expect.any(Object))
      expect(result.current.localCurrency).toBe('JPY')
      expect(result.current.convert(100)).toBe(15000) // 100 * 150
    })
  })

  describe('callbacks', () => {
    it('should call onReady when ready', async () => {
      global.fetch = createFetchMock()
      const onReadySpy = vi.fn()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          onReady: onReadySpy
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(onReadySpy).toHaveBeenCalledWith('USD')
    })

    it('should call onError when error occurs', async () => {
      global.fetch = createFetchErrorMock('api')
      const onErrorSpy = vi.fn()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          onError: onErrorSpy
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(onErrorSpy).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      global.fetch = createFetchErrorMock('api')

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeTruthy()
      expect(result.current.isReady).toBe(false)
      expect(result.current.convert(100)).toBeNull()
    })

    it('should handle missing API key', async () => {
      global.fetch = vi.fn()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: ''
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeTruthy()
      expect(result.current.error?.message).toContain('API key is missing')
    })
  })

  describe('batch conversion performance', () => {
    it('should handle many conversions efficiently', async () => {
      global.fetch = createFetchMock()

      const { result } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          manualCurrency: 'EUR'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Convert 1000 prices
      const prices = Array.from({ length: 1000 }, (_, i) => i + 1)
      const start = performance.now()
      const converted = prices.map(p => result.current.convert(p))
      const end = performance.now()

      // Should complete quickly (< 50ms for 1000 conversions)
      expect(end - start).toBeLessThan(50)

      // All should be valid
      expect(converted.every(p => typeof p === 'number')).toBe(true)
      expect(converted[0]).toBe(0.88) // 1 * 0.88
      expect(converted[999]).toBe(880) // 1000 * 0.88
    })

    it('should provide stable function references', async () => {
      global.fetch = createFetchMock()

      const { result, rerender } = renderHook(
        () => useCurrencyLocalizer({
          baseCurrency: 'USD',
          apiKey: 'test-api-key',
          manualCurrency: 'EUR'
        }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      const convertRef1 = result.current.convert
      const formatRef1 = result.current.format

      // Trigger re-render
      rerender()

      // Function references should be stable (memoized)
      expect(result.current.convert).toBe(convertRef1)
      expect(result.current.format).toBe(formatRef1)
    })
  })
})
