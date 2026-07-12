const path = require('path');
const { spawnSync } = require('child_process');

const STABLE_RELEASE_REF = /^refs\/tags\/v\d+\.\d+\.\d+$/;
const RELEASE_CHANNELS = new Set(['stable', 'non-stable']);

function classifyReleaseRef(ref) {
  return STABLE_RELEASE_REF.test(ref || '') ? 'stable' : 'non-stable';
}

function resolveReleaseChannel(value) {
  const channel = value || 'non-stable';
  if (!RELEASE_CHANNELS.has(channel)) {
    throw new Error(`Unsupported FORGE_RELEASE_CHANNEL: ${channel}`);
  }
  return channel;
}

function readStableReleaseConfig(env) {
  const names = ['appleId', 'appleIdPassword', 'teamId', 'CSC_NAME'];
  const missing = names.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Stable macOS release requires: ${missing.join(', ')}`);
  }
  return {
    appleId: env.appleId,
    appleIdPassword: env.appleIdPassword,
    teamId: env.teamId,
    cscName: env.CSC_NAME,
  };
}

function parseCodesignMetadata(output) {
  const values = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const authorities = values
    .filter((line) => line.startsWith('Authority='))
    .map((line) => line.slice('Authority='.length));
  const signatureLine = values.find((line) => line.startsWith('Signature=') || line.startsWith('Signature size='));
  const teamLine = values.find((line) => line.startsWith('TeamIdentifier='));
  return {
    authorities,
    signature: signatureLine ? signatureLine.replace(/^Signature(?: size)?=/, '') : null,
    teamIdentifier: teamLine ? teamLine.slice('TeamIdentifier='.length) : null,
  };
}

function assertTrustedSignature(metadata, config) {
  const developerIdentity = metadata.authorities.find((authority) => authority.startsWith('Developer ID Application:'));
  if (metadata.signature === 'adhoc' || !developerIdentity) {
    throw new Error('Stable macOS release rejected an unsigned or ad-hoc signature.');
  }
  if (metadata.teamIdentifier !== config.teamId) {
    throw new Error('Stable macOS release rejected a mismatched Apple team.');
  }
  if (developerIdentity !== config.cscName) {
    throw new Error('Stable macOS release rejected a mismatched Developer ID identity.');
  }
}

function runCommand(spawn, command, args) {
  const result = spawn(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

async function loadNotarize(options) {
  const { notarize } = await import('@electron/notarize');
  return notarize(options);
}

async function runAfterSign(context, dependencies = {}) {
  if (context.electronPlatformName !== 'darwin') return;

  const env = dependencies.env || process.env;
  const logger = dependencies.logger || console;
  const spawn = dependencies.spawnSync || spawnSync;
  const notarize = dependencies.notarize || loadNotarize;
  const channel = resolveReleaseChannel(env.FORGE_RELEASE_CHANNEL);
  const stable = channel === 'stable';
  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const stableConfig = stable ? readStableReleaseConfig(env) : null;

  let metadataOutput;
  try {
    runCommand(spawn, 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
    metadataOutput = runCommand(spawn, 'codesign', ['--display', '--verbose=4', appPath]);
  } catch (error) {
    if (stable) {
      throw new Error('Stable macOS release requires a valid Developer ID signature.', {
        cause: error,
      });
    }
    logger.warn(`Non-stable macOS build is unsigned; applying an ad-hoc signature to ${appName}.`);
    try {
      runCommand(spawn, 'codesign', ['--force', '--deep', '--sign', '-', appPath]);
    } catch {
      logger.warn('Non-stable macOS build ad-hoc signing failed; continuing with a non-release artifact.');
      return;
    }
    logger.warn('Ad-hoc-signed artifact is not suitable for a stable release.');
    return;
  }

  if (stable) {
    assertTrustedSignature(parseCodesignMetadata(metadataOutput), stableConfig);
  }

  const missingNonStableCredentials = ['appleId', 'appleIdPassword'].filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === ''
  );
  if (!stable && missingNonStableCredentials.length > 0) {
    logger.warn('Skipping notarization for a non-stable macOS build; artifact is not suitable for a stable release.');
    return;
  }

  const notarizationConfig = stable
    ? stableConfig
    : {
        appleId: env.appleId,
        appleIdPassword: env.appleIdPassword,
        teamId: env.teamId,
      };

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath,
      appleId: notarizationConfig.appleId,
      appleIdPassword: notarizationConfig.appleIdPassword,
      teamId: notarizationConfig.teamId,
    });
    logger.log(`Notarization completed successfully for ${appName}.`);
  } catch (error) {
    if (stable) {
      throw new Error('Stable macOS release notarization failed.', { cause: error });
    }
    logger.warn('Non-stable macOS build notarization failed; continuing with a non-release artifact.');
  }
}

exports.default = async function afterSign(context) {
  return runAfterSign(context);
};
exports.classifyReleaseRef = classifyReleaseRef;
exports.resolveReleaseChannel = resolveReleaseChannel;
exports.readStableReleaseConfig = readStableReleaseConfig;
exports.parseCodesignMetadata = parseCodesignMetadata;
exports.assertTrustedSignature = assertTrustedSignature;
exports.runAfterSign = runAfterSign;
