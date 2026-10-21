{
  lib,
  stdenv,
  fetchurl,
  makeWrapper,
  autoPatchelfHook,
}:

let
  version = "0.10.14+7d59c7ec9";
  urlVersion = lib.replaceStrings [ "+" ] [ "%2B" ] version;
  distributions = {
    aarch64-darwin = {
      target = "darwin-aarch64";
      hash = "sha256-IJZ/k4msVFCIme4vwFGjRw0FFFK6xYGKlpbtTBRPPsM=";
    };
    x86_64-linux = {
      target = "linux-x86_64";
      hash = "sha256-kiZpTen/l42x7Pggt3EMQiToTsenaxmiItlvDNTjG2o=";
    };
  };
  distribution = distributions.${stdenv.hostPlatform.system};
  core = fetchurl {
    url = "https://cli.moonbitlang.com/cores/core-${urlVersion}.tar.gz";
    hash = "sha256-bxi4/eoY+F5iinXkob05d8WlycaoNv2IJBkrDmvZGxQ=";
  };
in
stdenv.mkDerivation {
  pname = "moonbit";
  inherit version;
  src = fetchurl {
    url = "https://cli.moonbitlang.com/binaries/${urlVersion}/moonbit-${distribution.target}.tar.gz";
    inherit (distribution) hash;
  };

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
  dontUnpack = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    moonRoot="$out/share/moon"
    mkdir -p "$moonRoot" "$out/bin"
    tar -xzf "$src" -C "$moonRoot"
    tar -xzf ${core} -C "$moonRoot/lib"
    chmod -R u+w "$moonRoot"
    chmod +x "$moonRoot"/bin/* "$moonRoot/bin/internal/tcc"
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      autoPatchelf "$moonRoot"
    ''}

    export MOON_HOME="$moonRoot"
    export PATH="$moonRoot/bin:$PATH"
    moon -C "$moonRoot/lib/core" bundle --warn-list -a --all
    moon -C "$moonRoot/lib/core" bundle --warn-list -a --target wasm-gc --quiet

    for command in moon moonc moonrun moonfmt mooninfo moondoc moon-lsp; do
      makeWrapper "$moonRoot/bin/$command" "$out/bin/$command" \
        --set MOON_TOOLCHAIN_ROOT "$moonRoot" \
        --prefix PATH : "$moonRoot/bin"
    done
    ln -s moon "$out/bin/moonx"
    runHook postInstall
  '';

  meta = {
    description = "Pinned official MoonBit toolchain and bundled standard library";
    homepage = "https://www.moonbitlang.com/";
    # The compiler distribution has its own license; core is Apache-2.0.
    license = lib.licenses.unfree;
    platforms = builtins.attrNames distributions;
  };
}
