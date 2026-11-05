'use strict';

let sdk = null;
let started = false;
let shutdownPromise = null;

function isEnabled() {
  if (process.env.MILAN_CLOUD_TRACE_ENABLED === 'false') return false;
  if (process.env.MILAN_CLOUD_TRACE_ENABLED === 'true') return true;
  return !!process.env.K_SERVICE;
}

function start() {
  if (started) return true;
  if (!isEnabled()) {
    console.info('[MILAN telemetry] Cloud Trace disabled in this environment');
    return false;
  }

  try {
    const grpc = require('@grpc/grpc-js');
    const { GoogleAuth } = require('google-auth-library');
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    const { gcpDetector } = require('@opentelemetry/resource-detector-gcp');
    const { resourceFromAttributes } = require('@opentelemetry/resources');

    const auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });

    // Resolve ADC lazily for every gRPC call. Google Auth handles token refresh.
    // MetadataGenerator is the grpc-js-native contract and avoids pretending that
    // a lightweight adapter is an OAuth2Client instance.
    const credentials = grpc.credentials.combineChannelCredentials(
      grpc.credentials.createSsl(),
      grpc.credentials.createFromMetadataGenerator((options, callback) => {
        Promise.resolve()
          .then(() => auth.getClient())
          .then(client => client.getRequestHeaders(options.service_url))
          .then(headers => {
            const metadata = new grpc.Metadata();
            for (const [key, value] of headers.entries()) {
              metadata.set(key.toLowerCase(), value);
            }
            callback(null, metadata);
          })
          .catch(callback);
      })
    );

    const exporter = new OTLPTraceExporter({
      url: 'https://telemetry.googleapis.com',
      credentials
    });

    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      'project-90b3b29e-1057-434c-bac';

    const spanProcessor = new BatchSpanProcessor({
      exporter,
      maxQueueSize: 256,
      maxExportBatchSize: 128,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 1500
    });

    sdk = new NodeSDK({
      serviceName: 'milan-app',
      resource: resourceFromAttributes({ 'gcp.project_id': projectId }),
      autoDetectResources: true,
      resourceDetectors: [gcpDetector],
      spanProcessors: [spanProcessor],
      metricReaders: [],
      logRecordProcessors: []
    });

    sdk.start();
    started = true;

    console.info('[MILAN telemetry] Cloud Trace OTLP exporter initialized', {
      service: 'milan-app',
      endpoint: 'https://telemetry.googleapis.com',
      signals: ['traces']
    });

    return true;
  } catch (err) {
    sdk = null;
    started = false;
    console.error('[MILAN telemetry] Cloud Trace initialization failed:', err.message);
    return false;
  }
}

async function shutdown(timeoutMs = 2200) {
  if (!sdk || !started) return;
  if (!shutdownPromise) {
    const shutdownWork = sdk.shutdown();
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    shutdownPromise = Promise.race([
      shutdownWork.then(() => true),
      timeout
    ]).then(flushed => {
      clearTimeout(timer);
      if (flushed) {
        console.info('[MILAN telemetry] Cloud Trace batch flushed');
      } else {
        console.warn(`[MILAN telemetry] Cloud Trace flush exceeded ${timeoutMs}ms`);
      }
    }).catch(err => {
      clearTimeout(timer);
      console.error('[MILAN telemetry] Cloud Trace shutdown failed:', err.message);
    });
  }
  return shutdownPromise;
}

module.exports = { start, shutdown };
