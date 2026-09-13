from slug import slugify

assert slugify("Hello World") == "hello-world"
assert slugify("Already-Slug") == "already-slug"
print("public tests passed")
