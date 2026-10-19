ALTER TABLE shared_settings
ADD COLUMN apply_json TEXT NOT NULL DEFAULT '{"countdownDates":true,"yearlyCountdownDates":true,"userChimeTimes":true,"isChimeEnabled":true,"isPreChimeEnabled":true,"isBannerVisible":true,"isVerticalBanner":true}';
