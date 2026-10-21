{
  lib,
  runCommand,
  fetchurl,
  unzip,
}:

# A minimal registry and source closure: resolution can see only these versions.
let
  locked = builtins.fromJSON (builtins.readFile ./mooncakes-lock.json);
  archives = map (entry: {
    inherit entry;
    archive = fetchurl {
      url = "https://download.mooncakes.io/user/${
        lib.replaceStrings [ "/" ] [ "%2F" ] entry.name
      }%2F${entry.version}.zip";
      sha256 = entry.checksum;
    };
  }) locked;
in
runCommand "tanikun-mooncakes" { nativeBuildInputs = [ unzip ]; } ''
  mkdir -p "$out/sources" "$out/registry/index/user" "$out/registry/cache"
  ${lib.concatMapStringsSep "\n" ({ entry, archive }: ''
    mkdir -p "$out/sources/${entry.name}" \
      "$out/registry/index/user/$(dirname ${entry.name})" \
      "$out/registry/cache/${entry.name}"
    unzip -q ${archive} -d "$out/sources/${entry.name}"
    cp ${archive} "$out/registry/cache/${entry.name}/${entry.version}.zip"
    cp ${
      builtins.toFile "${lib.replaceStrings [ "/" ] [ "-" ] entry.name}.index" (
        builtins.toJSON entry + "\n"
      )
    } \
      "$out/registry/index/user/${entry.name}.index"
  '') archives}
''
