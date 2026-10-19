UPDATE shared_settings
SET settings_json = '{
  "countdownDates": [],
  "yearlyCountdownDates": [
    {"date":"02-14","label":"バレンタイン","color":"pink","type":"yearly"},
    {"date":"03-31","label":"今年度終了","color":"gray","type":"yearly"},
    {"date":"06-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"07-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"08-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"09-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"10-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"11-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"12-15","label":"レポート期限","color":"blue","type":"yearly"},
    {"date":"12-25","label":"クリスマス","color":"red","type":"yearly"},
    {"date":"12-31","label":"大晦日","color":"gray","type":"yearly"}
  ],
  "userChimeTimes": [
    {"time":"09:30","chime":true,"preChime":true},
    {"time":"09:45","chime":true,"preChime":true},
    {"time":"10:35","chime":true,"preChime":false},
    {"time":"10:45","chime":true,"preChime":true},
    {"time":"11:35","chime":true,"preChime":false},
    {"time":"11:45","chime":true,"preChime":true},
    {"time":"12:35","chime":true,"preChime":false},
    {"time":"13:15","chime":true,"preChime":true},
    {"time":"14:05","chime":true,"preChime":false},
    {"time":"14:15","chime":true,"preChime":true},
    {"time":"15:05","chime":true,"preChime":false},
    {"time":"15:15","chime":true,"preChime":true},
    {"time":"16:05","chime":true,"preChime":false},
    {"time":"16:15","chime":true,"preChime":false},
    {"time":"17:25","chime":false,"preChime":true},
    {"time":"17:30","chime":true,"preChime":true}
  ],
  "isChimeEnabled": false,
  "isPreChimeEnabled": false,
  "isBannerVisible": false,
  "isVerticalBanner": false
}',
updated_at = datetime('now')
WHERE id = 1 AND settings_json = '{}';
