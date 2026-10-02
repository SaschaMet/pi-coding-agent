# Presidio analyzer with English (stock) + German models for the pii-redaction PI package.
# Base tag is pinned; the German wheel is pinned by sha256.
FROM ghcr.io/data-privacy-stack/presidio-analyzer:2.2.364

USER root
ARG DE_WHEEL=https://github.com/explosion/spacy-models/releases/download/de_core_news_lg-3.8.0/de_core_news_lg-3.8.0-py3-none-any.whl
ARG DE_SHA256=36fda650e476b54d5e87803635e36dadd1e8e034c4b5962088586d684f4c9fed
# --no-deps: the image's spaCy 3.8.13 already satisfies the model, and a resolver
# run could change the locked environment.
# pip needs the original wheel filename.
RUN WHL="/tmp/$(basename "$DE_WHEEL")" \
  && curl -fsSLo "$WHL" "$DE_WHEEL" \
  && echo "$DE_SHA256  $WHL" | sha256sum -c - \
  && pip install --no-cache-dir --no-deps "$WHL" \
  && rm "$WHL"

COPY analyzer-conf.yml /app/conf/pii-analyzer.yml
# One config file holds languages, models and recognizers; the stock split files
# are cleared so nothing silently falls back to the English-only defaults.
ENV ANALYZER_CONF_FILE=/app/conf/pii-analyzer.yml \
    NLP_CONF_FILE= \
    RECOGNIZER_REGISTRY_CONF_FILE=
USER 1001
