import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setCrf(18);
Config.setBrowserExecutable('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
Config.setChromiumDisableWebSecurity(true);
Config.setConcurrency(2);
