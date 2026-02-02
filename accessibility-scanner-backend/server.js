// server.js - Node.js backend for Accessibility Insights integration
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Global error handlers (prevent crash on unexpected errors)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Create temp directory for reports
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Accessibility Insights scan endpoint
app.post('/api/accessibility-insights', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a valid URL to scan',
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid URL',
        message:
          'Please provide a valid URL (including protocol, e.g. https://example.com).',
      });
    }

    console.log(`Starting Accessibility Insights scan for: ${parsedUrl.href}`);

    const timestamp = Date.now();
    const reportDir = path.join(tempDir, `scan_${timestamp}`);

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Run the scan using CLI
    const cli = 'npx';
    const args = [
      'accessibility-insights-scan',
      '--crawl',
      '--url',
      parsedUrl.href,
      '--output',
      reportDir,
      '--restart',
    ];

    console.log(`Running command: ${cli} ${args.join(' ')}`);

    console.log();

    // Execute CLI command
    const scanResult = await new Promise((resolve, reject) => {
      const startTime = Date.now();
      console.log('Starting scan process...');

      const childProcess = execFile(
        cli,
        args,
        {
          timeout: 300000,
          maxBuffer: 20 * 1024 * 1024,
          cwd: __dirname,
        },
        (error, stdout, stderr) => {
          const duration = Date.now() - startTime;
          console.log(`Scan completed in ${duration}ms`);

          if (error) {
            console.error('CLI scan error:', error);
            return reject(new Error(`Scan failed: ${error.message}`));
          }

          if (stderr) {
            console.warn('CLI stderr:', stderr);
          }

          resolve({ stdout, stderr });
        }
      );

      // Log progress every 30 seconds
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        console.log(
          `Scan still running... elapsed: ${Math.round(elapsed / 1000)}s`
        );
      }, 30000);

      childProcess.on('close', () => {
        clearInterval(progressInterval);
      });
    });

    console.log('Scan completed, processing results...');

    const reportFiles = fs.readdirSync(reportDir);
    let jsonReport = null;

    console.log('Available report files:', reportFiles);

    // Function to parse scan results from key_value_stores
    const parseCrawlResults = (reportDir) => {
      const results = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        totalUrls: 0,
        failedUrls: 0,
        passedUrls: 0,
      };

      try {
        // Look for key_value_stores directory which contains individual scan results
        const kvStoresPath = path.join(reportDir, 'key_value_stores');
        if (fs.existsSync(kvStoresPath)) {
          const scanResultsPath = path.join(kvStoresPath, 'scan-results');
          if (fs.existsSync(scanResultsPath)) {
            const resultFiles = fs
              .readdirSync(scanResultsPath)
              .filter((f) => f.endsWith('.report.html'));
            console.log(`Found ${resultFiles.length} individual page reports`);

            results.totalUrls = resultFiles.length;
            let failedUrlCount = 0;
            let passedUrlCount = 0;

            // Parse each individual report
            for (const resultFile of resultFiles.slice(0, 50)) {
              // Limit to first 50 to avoid overwhelming
              try {
                const reportPath = path.join(scanResultsPath, resultFile);
                const htmlContent = fs.readFileSync(reportPath, 'utf8');

                // Extract violations from HTML content by looking for specific patterns
                const violationMatches = htmlContent.match(
                  /color-contrast.*?(\d+)\s*Failed/gi
                );
                if (violationMatches && violationMatches.length > 0) {
                  failedUrlCount++;
                  // Extract URL from the HTML content
                  const urlMatch = htmlContent.match(
                    /target-blank.*?href="([^"]+)"/i
                  );
                  const url = urlMatch ? urlMatch[1] : `page-${resultFile}`;

                  results.violations.push({
                    id: 'color-contrast',
                    impact: 'serious',
                    description:
                      'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
                    helpUrl:
                      'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
                    nodes: [
                      {
                        target: [url],
                        html: 'Multiple elements with insufficient color contrast',
                        failureSummary:
                          'Color contrast ratio does not meet WCAG AA standards',
                      },
                    ],
                  });
                } else {
                  passedUrlCount++;
                }

                // Look for passed checks
                const passedMatches = htmlContent.match(/(\d+)\s*Passed/gi);
                if (passedMatches && passedMatches.length > 0) {
                  const passedCount = parseInt(
                    passedMatches[0].match(/\d+/)[0]
                  );
                  if (passedCount > 0) {
                    results.passes.push({
                      id: 'multiple-checks',
                      description: `${passedCount} accessibility checks passed`,
                      nodes: passedCount,
                    });
                  }
                }
              } catch (fileError) {
                console.warn(
                  `Could not parse ${resultFile}:`,
                  fileError.message
                );
              }
            }

            results.failedUrls = failedUrlCount;
            results.passedUrls = passedUrlCount;
          }
        }
      } catch (error) {
        console.error('Error parsing crawl results:', error);
      }

      return results;
    };

    // Try to parse crawl results first
    jsonReport = parseCrawlResults(reportDir);

    // If we didn't get meaningful results, try other parsing methods
    if (jsonReport.violations.length === 0 && jsonReport.passes.length === 0) {
      // Look for SARIF or JSON report files
      for (const file of reportFiles) {
        const filePath = path.join(reportDir, file);

        if (file.endsWith('.sarif') || file.endsWith('.json')) {
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(fileContent);

            if (file.endsWith('.sarif')) {
              console.log('Processing SARIF file:', file);
              jsonReport = {
                violations: [],
                passes: [],
                incomplete: [],
                inapplicable: [],
              };

              if (parsedData.runs && parsedData.runs.length > 0) {
                const results = parsedData.runs[0].results || [];
                results.forEach((result) => {
                  if (result.level === 'error' || result.kind === 'fail') {
                    jsonReport.violations.push({
                      id: result.ruleId,
                      impact: result.level || 'serious',
                      description: result.message?.text || '',
                      helpUrl: result.helpUri || '',
                      nodes: result.locations?.map((loc) => ({
                        target: [
                          loc.physicalLocation?.artifactLocation?.uri ||
                            'unknown',
                        ],
                        html: loc.physicalLocation?.region?.snippet?.text || '',
                        failureSummary: result.message?.text || '',
                      })),
                    });
                  } else {
                    jsonReport.passes.push({
                      id: result.ruleId,
                      description: result.message?.text || '',
                      nodes: result.locations?.length || 0,
                    });
                  }
                });
              }
            } else {
              jsonReport = parsedData;
            }
            break;
          } catch (parseError) {
            console.warn(`Could not parse ${file}:`, parseError.message);
          }
        }
      }
    }

    if (
      !jsonReport ||
      (jsonReport.violations.length === 0 && jsonReport.passes.length === 0)
    ) {
      const htmlFile = reportFiles.find((file) => file.endsWith('.html'));
      if (htmlFile) {
        console.log('Found HTML report:', htmlFile);
        jsonReport = {
          violations: [],
          passes: [],
          incomplete: [],
          inapplicable: [],
          message:
            'HTML report generated successfully. Detailed analysis available in HTML format.',
        };
      }
    }

    if (!jsonReport) {
      jsonReport = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      };
    }

    const processedResults = {
      url: parsedUrl.href,
      timestamp: new Date().toISOString(),
      summary: {
        violations: jsonReport.violations?.length || 0,
        passes: jsonReport.passes?.length || 0,
        incomplete: jsonReport.incomplete?.length || 0,
        inapplicable: jsonReport.inapplicable?.length || 0,
        totalUrls: jsonReport.totalUrls || 0,
        failedUrls: jsonReport.failedUrls || 0,
        passedUrls: jsonReport.passedUrls || 0,
      },
      violations:
        jsonReport.violations?.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
          help: violation.helpUrl || null,
          nodes:
            violation.nodes?.map((node) => ({
              target: node.target,
              html: node.html?.substring(0, 200),
              failureSummary: node.failureSummary,
            })) || [],
        })) || [],
      passes:
        jsonReport.passes?.slice(0, 10)?.map((pass) => ({
          id: pass.id,
          description: pass.description,
          nodes: pass.nodes?.length || pass.nodes || 0,
        })) || [],
    };

    setTimeout(() => {
      try {
        fs.rmSync(reportDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Error cleaning up temp files:', error);
      }
    }, 60000);

    res.json(processedResults);
  } catch (error) {
    console.error('Accessibility Insights scan error:', error);
    res.status(500).json({
      error: 'Scan failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Helper function to calculate accessibility score
const calculateAccessibilityScore = (results) => {
  const { violations, passes } = results;
  
  // Weight violations by impact level
  const impactWeights = {
    critical: 10,
    serious: 7,
    moderate: 4,
    minor: 1
  };
  
  let totalDeductions = 0;
  violations.forEach(violation => {
    const weight = impactWeights[violation.impact] || 1;
    totalDeductions += violation.nodes.length * weight;
  });
  
  const totalPasses = passes.reduce((sum, pass) => sum + pass.nodes.length, 0);
  const totalTests = totalPasses + violations.reduce((sum, v) => sum + v.nodes.length, 0);
  
  // Calculate score (0-100)
  let score = 100;
  if (totalTests > 0) {
    score = Math.max(0, Math.round(100 - (totalDeductions / Math.max(totalTests, 1)) * 100));
  }
  
  return {
    score,
    totalTests,
    totalPasses,
    totalViolations: violations.length,
    totalNodes: violations.reduce((sum, v) => sum + v.nodes.length, 0)
  };
};

app.post('/api/scan-accessibility', async (req, res) => {
  const { 
    url, 
    tags = ['wcag2a', 'wcag2aa'], 
    disableRules = [], 
    include = null, 
    exclude = null,
    fastScan = false 
  } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set viewport for consistent results
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await page.goto(url, { waitUntil: 'networkidle' });

    let axeBuilder = new AxeBuilder({ page })
      .withTags(tags);

    // Disable expensive rules for fast scanning
    if (fastScan) {
      axeBuilder = axeBuilder.disableRules(['color-contrast', 'duplicate-id']);
    }

    // Disable specific rules if requested
    if (disableRules.length > 0) {
      axeBuilder = axeBuilder.disableRules(disableRules);
    }

    // Apply include/exclude selectors
    if (include) {
      axeBuilder = axeBuilder.include(include);
    }
    if (exclude) {
      axeBuilder = axeBuilder.exclude(exclude);
    }

    const results = await axeBuilder.analyze();
    const scoreData = calculateAccessibilityScore(results);

    await browser.close();

    console.log(`Scan completed for ${url} - Score: ${scoreData.score}/100`);

    res.json({
      success: true,
      accessibility: results,
      score: scoreData,
      scannedUrl: url,
      timestamp: new Date().toISOString(),
      scanOptions: {
        tags,
        disableRules,
        include,
        exclude,
        fastScan
      }
    });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      scannedUrl: url
    });
  }
});

// Get available axe-core rules and tags
app.get('/api/rules', async (req, res) => {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Get axe-core version and rules info
    const axeInfo = await page.evaluate(async () => {
      // Inject axe-core
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/axe-core@latest/axe.min.js';
      document.head.appendChild(script);
      
      await new Promise(resolve => {
        script.onload = resolve;
      });
      
      return {
        version: window.axe.version,
        rules: window.axe.getRules(),
        tags: window.axe.getTags()
      };
    });

    await browser.close();

    res.json({
      success: true,
      axeCore: {
        version: axeInfo.version,
        totalRules: axeInfo.rules.length,
        rules: axeInfo.rules.map(rule => ({
          ruleId: rule.ruleId,
          description: rule.description,
          help: rule.help,
          helpUrl: rule.helpUrl,
          impact: rule.impact,
          tags: rule.tags
        })),
        availableTags: axeInfo.tags
      }
    });
  } catch (error) {
    console.error('Rules endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Batch scan multiple URLs
app.post('/api/scan-batch', async (req, res) => {
  const { 
    urls = [], 
    tags = ['wcag2a', 'wcag2aa'], 
    disableRules = [],
    include = null,
    exclude = null,
    fastScan = false,
    maxConcurrent = 3 
  } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'URLs array is required and must not be empty'
    });
  }

  if (urls.length > 10) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 10 URLs allowed per batch'
    });
  }

  try {
    const results = [];
    const errors = [];
    
    // Process URLs in batches to avoid overwhelming the system
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          await page.setViewportSize({ width: 1920, height: 1080 });
          await page.goto(url, { waitUntil: 'networkidle' });

          let axeBuilder = new AxeBuilder({ page }).withTags(tags);

          if (fastScan) {
            axeBuilder = axeBuilder.disableRules(['color-contrast', 'duplicate-id']);
          }
          if (disableRules.length > 0) {
            axeBuilder = axeBuilder.disableRules(disableRules);
          }
          if (include) {
            axeBuilder = axeBuilder.include(include);
          }
          if (exclude) {
            axeBuilder = axeBuilder.exclude(exclude);
          }

          const scanResults = await axeBuilder.analyze();
          const scoreData = calculateAccessibilityScore(scanResults);

          await browser.close();

          return {
            url,
            success: true,
            accessibility: scanResults,
            score: scoreData,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          console.error(`Batch scan error for ${url}:`, error);
          return {
            url,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.push(result);
        } else {
          errors.push(result);
        }
      });
    }

    // Calculate batch summary
    const totalScanned = results.length + errors.length;
    const avgScore = results.length > 0 
      ? Math.round(results.reduce((sum, r) => sum + r.score.score, 0) / results.length)
      : 0;
    
    const totalViolations = results.reduce((sum, r) => sum + r.score.totalViolations, 0);

    res.json({
      success: true,
      summary: {
        totalUrls: urls.length,
        successful: results.length,
        failed: errors.length,
        averageScore: avgScore,
        totalViolations
      },
      results,
      errors,
      scanOptions: {
        tags,
        disableRules,
        include,
        exclude,
        fastScan,
        maxConcurrent
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Batch scan error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', async (_req, res) => {
  try {
    // Test basic browser functionality
    const startTime = Date.now();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('data:text/html,<html><body>Health Check</body></html>');
    await browser.close();
    const browserTestTime = Date.now() - startTime;

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      },
      browserTest: {
        success: true,
        responseTime: browserTestTime + 'ms'
      },
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Enhanced Accessibility Scanner API Server',
    version: '2.0.0',
    features: [
      'Direct axe-core integration with Playwright',
      'Real-time accessibility scoring (0-100)',
      'Configurable WCAG tags and rule sets',
      'Fast scan mode for performance',
      'Batch scanning up to 10 URLs',
      'Include/exclude CSS selectors'
    ],
    endpoints: [
      'GET /api/health - Service health check',
      'GET /api/rules - List available axe-core rules and tags',
      'POST /api/scan-accessibility - Run single URL accessibility scan',
      'POST /api/scan-batch - Run batch accessibility scan (up to 10 URLs)',
      'POST /api/accessibility-insights - Legacy endpoint (deprecated)'
    ],
    documentation: {
      scanOptions: {
        url: 'Required - URL to scan',
        tags: 'Array of WCAG tags (default: [wcag2a, wcag2aa])',
        disableRules: 'Array of rule IDs to disable',
        include: 'CSS selector to include specific elements',
        exclude: 'CSS selector to exclude specific elements',
        fastScan: 'Boolean - disable expensive rules for faster scanning'
      }
    }
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Enhanced Accessibility Scanner API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📋 API docs: http://localhost:${PORT}/`);
  console.log(`🔍 Main scan endpoint: POST http://localhost:${PORT}/api/scan-accessibility`);
  console.log(`📦 Batch scan endpoint: POST http://localhost:${PORT}/api/scan-batch`);
  console.log(`⚙️  Rules endpoint: GET http://localhost:${PORT}/api/rules`);
});
