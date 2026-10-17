#!/bin/bash
# Download the Django 5.1.15 sdist into a NEW EMPTY directory, verify PyPI's SHA-256, extract. Never installs or runs anything.
set -euo pipefail
URL='https://files.pythonhosted.org/packages/10/45/1ac68964193cfcc0b0912a0f68025d5bdb54f71ba7b8716e85b959874bd0/django-5.1.15.tar.gz'
SHA='46a356b5ff867bece73fc6365e081f21c569973403ee7e9b9a0316f27d0eb947'
DL=~/dsh-work/measure-runtime/src/django
if [ -e "$DL" ]; then echo "refuse: $DL exists"; exit 1; fi
mkdir -p "$DL"
cd "$DL"
curl -sS -o django-5.1.15.tar.gz "$URL"
ls -l django-5.1.15.tar.gz
echo "$SHA  django-5.1.15.tar.gz" | sha256sum -c -
mkdir tree
tar -xzf django-5.1.15.tar.gz -C tree --no-same-owner --no-same-permissions
ls -la tree tree/*
find tree -type l | head
echo "files: $(find tree -type f | wc -l)  py: $(find tree -type f -name '*.py' | wc -l)  pyi: $(find tree -type f -name '*.pyi' | wc -l)"
