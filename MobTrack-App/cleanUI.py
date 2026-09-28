import sys, re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'<Text style=\{s\.success\}>Authorized session for: \{linkedNumber\}</Text>[\s\S]*?<Text style=\{s\.text\}>Select features to allow during this session:</Text>\n', '', content)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
