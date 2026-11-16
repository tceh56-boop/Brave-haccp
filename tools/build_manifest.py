#!/usr/bin/env python3
"""
Пересборка DEPLOY_MANIFEST.json: размер и SHA-256 каждого файла поставки (gas/, install/,
tools/, документация этапов) и агрегированный хеш. Запускать перед релизом:
    python3 tools/build_manifest.py <номер_этапа> "<название>"
Агрегат — SHA-256 отсортированных строк «имя|sha256_файла» (как в исходном манифесте).
"""
import datetime, hashlib, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    stage = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    name = sys.argv[2] if len(sys.argv) > 2 else ''
    tracked = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
    files = []
    for rel in sorted(f for f in tracked if f and f != 'DEPLOY_MANIFEST.json'):
        data = open(os.path.join(ROOT, rel), 'rb').read()
        files.append({'name': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    agg = hashlib.sha256('\n'.join('%s|%s' % (f['name'], f['sha256']) for f in files).encode()).hexdigest()
    manifest = {'built_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stage': stage, 'name': name,
                'files': files, 'file_count': len(files), 'aggregate_sha256': agg,
                'aggregate_method': 'SHA-256 of sorted name|file_sha256 lines'}
    with open(os.path.join(ROOT, 'DEPLOY_MANIFEST.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('файлов:', len(files), 'aggregate:', agg)


if __name__ == '__main__':
    main()
