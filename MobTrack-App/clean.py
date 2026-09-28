import sys, re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

handleStartRegex = re.compile(r'const handleStart = \(\) => \{[\s\S]*?\};\n', re.DOTALL)
content = re.sub(handleStartRegex, '', content)

handleStopRegex = re.compile(r'const handleStop = async \(\) => \{[\s\S]*?\};\n', re.DOTALL)
content = re.sub(handleStopRegex, '', content)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
