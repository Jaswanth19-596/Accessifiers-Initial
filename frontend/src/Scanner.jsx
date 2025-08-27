import React, { useState } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Zap,
  Eye,
  Monitor,
  AlertTriangle,
  Settings,
} from 'lucide-react';

const Scanner = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [waveApiKey, setWaveApiKey] = useState('SmKMiuBU5751');
  const [backendUrl, setBackendUrl] = useState('http://localhost:3001');
  const [showSettings, setShowSettings] = useState(false);

  // WAVE API call
  const callWaveAPI = async (testUrl, apiKey) => {
    // Replace {testUrl} with the actual URL
    const waveUrl = `https://wave.webaim.org/api/request?key=${apiKey}&reporttype=2&url=${encodeURIComponent(
      testUrl
    )}`;

    try {
      const response = await fetch(waveUrl);
      if (!response.ok) {
        if (response.status === 400) {
          throw new Error('Invalid URL or API key for WAVE API');
        }
        throw new Error(
          `WAVE API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      // Handle WAVE API error responses
      if (data.status && !data.status.success) {
        throw new Error(`WAVE API: ${data.status.error || 'Unknown error'}`);
      }

      // Return the full response including statistics & categories
      return {
        status: data.status,
        statistics: data.statistics,
        categories: data.categories,
      };
    } catch (error) {
      console.error('WAVE API Error:', error);
      throw error;
    }
  };

  // Accessibility Insights API call (to your backend)
  const callAccessibilityInsights = async (testUrl) => {
    try {
      const response = await fetch(`${backendUrl}/api/accessibility-insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: testUrl }),
      });

      if (!response.ok) {
        throw new Error(
          `Accessibility Insights API error: ${response.status} ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error('Accessibility Insights Error:', error);
      throw error;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!url) {
      setError('Please enter a valid URL');
      return;
    }

    // Basic URL validation
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) {
      setError('Please enter a valid URL starting with http:// or https://');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);

    try {
      console.log('Starting scans for:', url);

      // Run both scans in parallel
      const [waveResults, insightsResults] = await Promise.allSettled([
        callWaveAPI(url, waveApiKey),
        callAccessibilityInsights(url),
      ]);

      // Process results
      const finalResults = {
        url: url,
        timestamp: new Date().toISOString(),
        wave: null,
        insights: null,
        waveError: null,
        insightsError: null,
      };

      if (waveResults.status === 'fulfilled') {
        finalResults.wave = waveResults.value;
      } else {
        finalResults.waveError = waveResults.reason.message;
      }

      if (insightsResults.status === 'fulfilled') {
        finalResults.insights = insightsResults.value;
      } else {
        finalResults.insightsError = insightsResults.reason.message;
      }

      setResults(finalResults);

      // Show error if both failed
      if (!finalResults.wave && !finalResults.insights) {
        setError(
          'Both scans failed. Please check your settings and try again.'
        );
      }
    } catch (err) {
      setError('Failed to scan the website. Please try again.');
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (impact) => {
    switch (impact) {
      case 'critical':
        return 'text-red-700 bg-red-100 border-red-200';
      case 'serious':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'moderate':
        return 'text-yellow-700 bg-yellow-100 border-yellow-200';
      case 'minor':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getOverallScore = () => {
    if (!results) return 0;

    let totalIssues = 0;
    let totalElements = 100; // Default fallback

    // Count WAVE errors
    if (results.wave?.categories) {
      totalIssues += results.wave.categories.error?.count || 0;
      totalElements = results.wave.statistics?.totalelements || totalElements;
    }

    // Count Insights violations
    if (results.insights?.summary) {
      totalIssues += results.insights.summary.violations || 0;
    }

    const score = Math.max(
      0,
      Math.round((1 - totalIssues / Math.max(totalElements, 10)) * 100)
    );
    return Math.min(100, score);
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Accessibility Scanner
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Real-time accessibility analysis using WAVE API & Accessibility
            Insights
          </p>
          <p className="text-sm text-gray-500">
            Built for the Accessibility Ratings Project
          </p>
        </div>

        {/* Settings Toggle */}
        <div className="mb-6 text-center">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <Settings className="w-4 h-4 mr-2" />
            {showSettings ? 'Hide Settings' : 'Show Settings'}
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8 border-l-4 border-yellow-400">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Configuration
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label
                  htmlFor="backendUrl"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Backend URL
                </label>
                <input
                  type="text"
                  id="backendUrl"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  URL of your Node.js backend running
                  accessibility-insights-scan
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scan Form */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-4"
          >
            <div className="flex-1">
              <label
                htmlFor="url"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Website URL
              </label>
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg"
                disabled={loading}
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={loading || !url}
                className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {loading ? (
                  <div className="flex items-center">
                    <Clock className="animate-spin w-4 h-4 mr-2" />
                    Scanning...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <Zap className="w-4 h-4 mr-2" />
                    Scan Website
                  </div>
                )}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center">
                <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                <span className="text-red-700">{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <Clock className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Scanning Website...
            </h3>
            <p className="text-gray-600">
              Running WAVE API and Accessibility Insights analysis. This may
              take a few moments.
            </p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* WAVE Results */}
              <div className="bg-white rounded-lg shadow-lg">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Eye className="w-6 h-6 text-blue-600 mr-3" />
                      <h3 className="text-xl font-bold text-gray-900">
                        WAVE Analysis
                      </h3>
                    </div>
                    {results.wave && (
                      <span className="text-sm text-gray-500">
                        {results.wave.statistics?.time?.toFixed(2)}s
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-6">
                  {results.waveError ? (
                    <div className="text-center py-8">
                      <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        WAVE Scan Failed
                      </h4>
                      <p className="text-red-600 text-sm">
                        {results.waveError}
                      </p>
                    </div>
                  ) : results.wave ? (
                    <div className="space-y-4">
                      {/* WAVE Statistics */}
                      {results.wave.statistics && (
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">
                              Total Elements:
                            </span>
                            <span className="ml-2 font-medium">
                              {results.wave.statistics.totalelements}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">
                              Credits Remaining:
                            </span>
                            <span className="ml-2 font-medium">
                              {results.wave.statistics.creditsremaining}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* WAVE Categories */}
                      {results.wave.categories && (
                        <div className="space-y-3">
                          {Object.entries(results.wave.categories).map(
                            ([category, data]) => (
                              <div
                                key={category}
                                className="border border-gray-200 rounded-md p-4"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="font-medium text-gray-900 capitalize">
                                    {category === 'error' && '🚨 '}
                                    {category === 'alert' && '⚠️ '}
                                    {category === 'feature' && '✅ '}
                                    {category}s
                                  </h4>
                                  <span
                                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                                      category === 'error'
                                        ? 'bg-red-100 text-red-800'
                                        : category === 'alert'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-green-100 text-green-800'
                                    }`}
                                  >
                                    {data.count}
                                  </span>
                                </div>
                                {data.items &&
                                  Object.keys(data.items).length > 0 && (
                                    <div className="text-sm text-gray-600 space-y-1">
                                      {Object.entries(data.items)
                                        .slice(0, 3)
                                        .map(([itemId, item]) => (
                                          <div
                                            key={itemId}
                                            className="flex justify-between"
                                          >
                                            <span>{item.description}</span>
                                            <span className="font-medium">
                                              {item.count}
                                            </span>
                                          </div>
                                        ))}
                                      {Object.keys(data.items).length > 3 && (
                                        <div className="text-gray-500 italic">
                                          +{Object.keys(data.items).length - 3}{' '}
                                          more...
                                        </div>
                                      )}
                                    </div>
                                  )}
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {/* {results.wave.statistics?.waveurl && (
                        <div className="pt-4 border-t border-gray-200">
                          <a
                            href={results.wave.statistics.waveurl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500"
                          >
                            <ExternalLink className="w-4 h-4 mr-1" />
                            View Full WAVE Report
                          </a>
                        </div>
                      )} */}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Accessibility Insights Results */}
              <div className="bg-white rounded-lg shadow-lg">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-center">
                    <Monitor className="w-6 h-6 text-green-600 mr-3" />
                    <h3 className="text-xl font-bold text-gray-900">
                      Accessibility Insights
                    </h3>
                  </div>
                </div>

                <div className="p-6">
                  {results.insightsError ? (
                    <div className="text-center py-8">
                      <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        Insights Scan Failed
                      </h4>
                      <p className="text-red-600 text-sm">
                        {results.insightsError}
                      </p>
                      <div className="mt-4 p-3 bg-blue-50 rounded-md text-left">
                        <p className="text-sm text-blue-800 font-medium mb-2">
                          Backend Setup Required:
                        </p>
                        <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                          <li>
                            Install:{' '}
                            <code className="bg-blue-100 px-1 rounded">
                              npm install accessibility-insights-scan
                            </code>
                          </li>
                          <li>Create a Node.js server with the endpoint</li>
                          <li>Update the backend URL in settings</li>
                        </ol>
                      </div>
                    </div>
                  ) : results.insights ? (
                    <div className="space-y-4">
                      {/* Summary */}
                      {results.insights.summary && (
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Violations:</span>
                            <span className="font-medium text-red-600">
                              {results.insights.summary.violations}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Passes:</span>
                            <span className="font-medium text-green-600">
                              {results.insights.summary.passes}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Incomplete:</span>
                            <span className="font-medium text-yellow-600">
                              {results.insights.summary.incomplete}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Inapplicable:</span>
                            <span className="font-medium text-gray-500">
                              {results.insights.summary.inapplicable}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Violations */}
                      {results.insights.violations &&
                        results.insights.violations.length > 0 && (
                          <div className="space-y-3">
                            <h4 className="font-medium text-gray-900">
                              Top Violations:
                            </h4>
                            {results.insights.violations
                              .slice(0, 5)
                              .map((violation, index) => (
                                <div
                                  key={index}
                                  className={`border rounded-md p-3 ${getSeverityColor(
                                    violation.impact
                                  )}`}
                                >
                                  <div className="flex items-start justify-between mb-2">
                                    <h5 className="font-medium text-sm">
                                      {violation.description}
                                    </h5>
                                    <span className="text-xs px-2 py-1 rounded-full bg-white bg-opacity-50">
                                      {violation.impact}
                                    </span>
                                  </div>
                                  {violation.nodes &&
                                    violation.nodes.length > 0 && (
                                      <div className="text-xs opacity-75">
                                        Affects {violation.nodes.length} element
                                        {violation.nodes.length !== 1
                                          ? 's'
                                          : ''}
                                      </div>
                                    )}
                                  {violation.help && (
                                    <a
                                      href={violation.help}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center text-xs mt-2 opacity-75 hover:opacity-100"
                                    >
                                      <ExternalLink className="w-3 h-3 mr-1" />
                                      Learn more
                                    </a>
                                  )}
                                </div>
                              ))}
                            {results.insights.violations.length > 5 && (
                              <p className="text-sm text-gray-500 italic">
                                +{results.insights.violations.length - 5} more
                                violations...
                              </p>
                            )}
                          </div>
                        )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scanner;
